//! Bilibili-specific extraction.
//!
//! Bilibili share links from the homepage carry no usable HTML content —
//! the video page is a SPA, and the initial HTML has only boilerplate. We
//! call Bilibili's public `view` API by BV id to get title, description,
//! uploader, duration, and thumbnail without needing to run JavaScript.

use std::io::Read;
use std::time::Duration;

const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_API_BYTES: u64 = 1_000_000;

pub struct BilibiliVideo {
    pub bvid: String,
    pub title: String,
    pub description: String,
    pub uploader: String,
    pub thumbnail: String,
    pub duration_sec: Option<i64>,
}

pub fn is_bilibili_url(url: &str) -> bool {
    extract_bvid(url).is_some()
}

/// Pull the BV id out of common Bilibili URL shapes:
///   <https://www.bilibili.com/video/BV1xxx/?spm_id_from>=...
///   <https://m.bilibili.com/video/BV1xxx>
///   <https://b23.tv/BV1xxx>
pub fn extract_bvid(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    let is_bili = host == "bilibili.com"
        || host.ends_with(".bilibili.com")
        || host == "b23.tv";
    if !is_bili {
        return None;
    }
    let path = parsed.path();
    // /video/BV1xxx[/…]
    if let Some(rest) = path.strip_prefix("/video/") {
        let id: String = rest.chars().take_while(|c| *c != '/' && *c != '?').collect();
        if is_valid_bvid(&id) {
            return Some(id);
        }
    }
    // b23.tv short links (/BV1xxx)
    let trimmed = path.trim_matches('/');
    if is_valid_bvid(trimmed) {
        return Some(trimmed.to_string());
    }
    None
}

fn is_valid_bvid(s: &str) -> bool {
    // BV ids are 12 chars starting with "BV", remaining 10 alphanumeric.
    s.len() == 12
        && s.starts_with("BV")
        && s[2..].chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn fetch_video(url: &str) -> Result<BilibiliVideo, String> {
    let bvid = extract_bvid(url).ok_or("不是有效的 Bilibili 链接")?;
    let api_url = format!(
        "https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
    );

    let body = fetch_text(&api_url)?;
    let v: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Bilibili API 响应解析失败: {e}"))?;

    let code = v["code"].as_i64().unwrap_or(-1);
    if code != 0 {
        let msg = v["message"].as_str().unwrap_or("unknown");
        return Err(format!("Bilibili API 错误 ({code}): {msg}"));
    }

    let d = &v["data"];
    let title = d["title"].as_str().unwrap_or("").trim().to_string();
    let description = d["desc"].as_str().unwrap_or("").trim().to_string();
    let uploader = d["owner"]["name"].as_str().unwrap_or("").trim().to_string();
    let thumbnail = d["pic"].as_str().unwrap_or("").trim().to_string();
    let duration_sec = d["duration"].as_i64();

    Ok(BilibiliVideo {
        bvid,
        title: if title.is_empty() {
            "Bilibili 视频".to_string()
        } else {
            title
        },
        description,
        uploader,
        thumbnail,
        duration_sec,
    })
}

fn fetch_text(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new()
        .redirects(5)
        .timeout(FETCH_TIMEOUT)
        .build();
    let resp = agent
        .get(url)
        .set(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        // Bilibili's web-interface API rejects requests without a Referer
        // header that looks like it originated from their site.
        .set("Referer", "https://www.bilibili.com/")
        .set("Accept", "application/json,text/plain,*/*")
        .call()
        .map_err(|e| format!("请求失败：{e}"))?;

    let mut body = String::new();
    resp.into_reader()
        .take(MAX_API_BYTES)
        .read_to_string(&mut body)
        .map_err(|e| format!("读取响应失败：{e}"))?;
    Ok(body)
}

/// Strip tracking / referrer query params so the same Bilibili video opened
/// from the homepage, a QR share, and the UP's space all dedupe to one clip.
pub fn clean_bilibili_url(url: &str) -> String {
    let Ok(mut u) = url::Url::parse(url) else {
        return url.to_string();
    };
    const DROP_KEYS: &[&str] = &[
        "spm_id_from",
        "from_spmid",
        "share_source",
        "share_medium",
        "share_plat",
        "share_session_id",
        "share_tag",
        "vd_source",
        "from",
        "seid",
        "timestamp",
        "bbid",
        "buvid",
        "unique_k",
    ];
    let keep: Vec<(String, String)> = u
        .query_pairs()
        .filter(|(k, _)| !DROP_KEYS.contains(&k.as_ref()))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    u.set_query(None);
    if !keep.is_empty() {
        let mut q = u.query_pairs_mut();
        for (k, v) in keep {
            q.append_pair(&k, &v);
        }
    }
    // Bilibili video pages sometimes arrive with a trailing "/" that survives
    // query stripping — normalize to a bare `/video/BV…` form.
    u.to_string().trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_bvid_from_homepage_share() {
        assert_eq!(
            extract_bvid("https://www.bilibili.com/video/BV1hAQiBmE7Q/?spm_id_from=333.1007.tianma.1-1-1.click").as_deref(),
            Some("BV1hAQiBmE7Q"),
        );
    }

    #[test]
    fn extracts_bvid_from_m_subdomain() {
        assert_eq!(
            extract_bvid("https://m.bilibili.com/video/BV1hAQiBmE7Q").as_deref(),
            Some("BV1hAQiBmE7Q"),
        );
    }

    #[test]
    fn extracts_bvid_from_b23() {
        assert_eq!(
            extract_bvid("https://b23.tv/BV1hAQiBmE7Q").as_deref(),
            Some("BV1hAQiBmE7Q"),
        );
    }

    #[test]
    fn rejects_non_bilibili() {
        assert_eq!(extract_bvid("https://example.com/video/BV1hAQiBmE7Q"), None);
    }

    #[test]
    fn clean_url_strips_spm_id_from() {
        let cleaned = clean_bilibili_url(
            "https://www.bilibili.com/video/BV1hAQiBmE7Q/?spm_id_from=333.1007.tianma.1-1-1.click",
        );
        assert!(!cleaned.contains("spm_id_from"));
        assert!(cleaned.contains("BV1hAQiBmE7Q"));
    }

    #[test]
    fn clean_url_keeps_useful_params() {
        let cleaned = clean_bilibili_url("https://www.bilibili.com/video/BV1hAQiBmE7Q/?t=120");
        assert!(cleaned.contains("t=120"));
    }
}
