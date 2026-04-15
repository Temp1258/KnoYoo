//! OS keychain wrapper for API secrets.
//!
//! Secrets (API keys) are stored in the host keychain — macOS Keychain
//! Services or Windows Credential Manager — so they never touch our `SQLite`
//! database. The database backup / restore flow deliberately does NOT move
//! keychain entries, which is the right default: a user restoring on a
//! different machine shouldn't inherit stale keys, and a copied `notes.db`
//! carries no credentials at all.
//!
//! All entries live under `SERVICE = "com.knoyoo.desktop"` and are keyed by
//! `account` strings the caller picks (e.g. `"asr_siliconflow"`). The
//! service/account split follows the platform convention and makes keys
//! visible under the same app identity in Keychain Access.
//!
//! ## Testing
//!
//! The `#[cfg(test)]` variant replaces the real keychain with a
//! thread-local `HashMap`, so unit tests can exercise migration logic
//! without touching the developer's login keychain and without tests in
//! different threads clobbering each other.

use crate::error::AppError;

/// Service identifier registered in the OS keychain. Matches the Tauri
/// bundle identifier so Keychain Access shows keys under the `KnoYoo` app.
/// Used by both the always-on release backend and the env-var-gated
/// keychain path inside the dev backend.
#[cfg(not(test))]
pub const SERVICE: &str = "com.knoyoo.desktop";

/// Extract the last four characters of a key for display ("key hint" /
/// 尾号 in the UI). Char-based indexing so multi-byte keys don't panic.
/// Returns an empty string for keys shorter than four chars — tiny keys
/// are either invalid or so short that even the tail reveals too much.
pub fn key_last_four(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() < 4 {
        return String::new();
    }
    chars[chars.len() - 4..].iter().collect()
}

pub use imp::{delete, get, set};

// ---------------------------------------------------------------------------
// Production backend: real OS keychain
// ---------------------------------------------------------------------------

// Real keychain implementation. Always compiled in non-test builds —
// release builds use it directly, dev builds reach for it only when the
// developer opts in via `KNOYOO_USE_KEYCHAIN=1`.
#[cfg(not(test))]
mod keychain_impl {
    use super::{AppError, SERVICE};
    use keyring::{Entry, Error as KErr};
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    /// Process-wide cache of unlocked secrets. Each miss goes through the
    /// OS keychain; each hit returns immediately. This is the main defence
    /// against repeated macOS keychain prompts in dev builds where the
    /// binary's code signature shifts across rebuilds and macOS insists on
    /// re-authorising each access. In release (signed) builds the keychain
    /// only prompts once too, so the cache is a pure perf win.
    ///
    /// Lifetime: the cache dies with the process. We never persist it —
    /// that would defeat the point of keychain storage.
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

    fn cache() -> &'static Mutex<HashMap<String, String>> {
        CACHE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn cache_put(account: &str, value: &str) {
        if let Ok(mut g) = cache().lock() {
            g.insert(account.to_string(), value.to_string());
        }
    }

    fn cache_drop(account: &str) {
        if let Ok(mut g) = cache().lock() {
            g.remove(account);
        }
    }

    /// Fetch a secret. `Ok(None)` means "no such entry" (first-time setup
    /// or the user deleted the key); `Err(_)` means the keychain itself
    /// refused — misconfigured entitlements, locked keychain, etc.
    pub fn get(account: &str) -> Result<Option<String>, AppError> {
        if let Ok(g) = cache().lock() {
            if let Some(v) = g.get(account) {
                return Ok(Some(v.clone()));
            }
        }
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| AppError::io(format!("keychain open {account}: {e}")))?;
        match entry.get_password() {
            Ok(v) => {
                cache_put(account, &v);
                Ok(Some(v))
            }
            Err(KErr::NoEntry) => Ok(None),
            Err(e) => Err(AppError::io(format!("keychain read {account}: {e}"))),
        }
    }

    pub fn set(account: &str, value: &str) -> Result<(), AppError> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| AppError::io(format!("keychain open {account}: {e}")))?;
        // Delete any existing credential first, then add a fresh one.
        // macOS `SecKeychainItemModifyContent` (which keyring uses for
        // in-place updates) triggers TWO ACL checks — one to locate the
        // item, one to modify — and in dev builds each check prompts
        // the user separately. Deleting and re-adding uses only the
        // "add" path, which the current binary owns by definition, so
        // macOS doesn't prompt at all. Delete errors are swallowed
        // (NoEntry is normal; anything else we log but still try the
        // add so a bogus ACL state doesn't wedge the flow forever).
        match entry.delete_credential() {
            Ok(()) | Err(KErr::NoEntry) => {}
            Err(e) => {
                tracing::warn!("keychain pre-delete {account} failed: {e}");
            }
        }
        entry
            .set_password(value)
            .map_err(|e| AppError::io(format!("keychain write {account}: {e}")))?;
        cache_put(account, value);
        Ok(())
    }

    /// Deleting a missing entry is treated as success — the caller's
    /// intent ("make sure this secret is gone") is already satisfied.
    pub fn delete(account: &str) -> Result<(), AppError> {
        let entry = Entry::new(SERVICE, account)
            .map_err(|e| AppError::io(format!("keychain open {account}: {e}")))?;
        let result = match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(KErr::NoEntry) => Ok(()),
            Err(e) => Err(AppError::io(format!("keychain delete {account}: {e}"))),
        };
        cache_drop(account);
        result
    }
}

// ---------------------------------------------------------------------------
// Test backend: thread-local in-memory store
// ---------------------------------------------------------------------------

// Debug-build app_kv fallback. Stashes secrets in local SQLite under
// `_dev_secret_<account>` rows. Used when `KNOYOO_USE_KEYCHAIN=1` is
// NOT set — i.e. the default dev experience, which avoids the macOS
// keychain prompt storm caused by ad-hoc / shifting code signatures.
//
// Threat model: the developer's own machine, the .db is not being
// shipped or shared. Plaintext is honest about that.
#[cfg(all(not(test), debug_assertions))]
mod app_kv_impl {
    use super::AppError;
    use crate::db::open_db;
    use rusqlite::OptionalExtension;

    fn kv_key(account: &str) -> String {
        format!("_dev_secret_{account}")
    }

    pub fn get(account: &str) -> Result<Option<String>, AppError> {
        let conn = open_db().map_err(AppError::database)?;
        let stored: Option<String> = conn
            .query_row(
                "SELECT val FROM app_kv WHERE key = ?1",
                [kv_key(account)],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| AppError::database(e.to_string()))?;
        Ok(stored.filter(|s| !s.is_empty()))
    }

    pub fn set(account: &str, value: &str) -> Result<(), AppError> {
        let conn = open_db().map_err(AppError::database)?;
        conn.execute(
            "INSERT INTO app_kv(key, val) VALUES(?1, ?2)
               ON CONFLICT(key) DO UPDATE SET val = excluded.val",
            rusqlite::params![kv_key(account), value],
        )
        .map_err(|e| AppError::database(e.to_string()))?;
        Ok(())
    }

    pub fn delete(account: &str) -> Result<(), AppError> {
        let conn = open_db().map_err(AppError::database)?;
        conn.execute(
            "DELETE FROM app_kv WHERE key = ?1",
            [kv_key(account)],
        )
        .map_err(|e| AppError::database(e.to_string()))?;
        Ok(())
    }
}

// ── Backend dispatch ────────────────────────────────────────────────

// Release: always go through the real keychain.
#[cfg(all(not(test), not(debug_assertions)))]
mod imp {
    pub use super::keychain_impl::{delete, get, set};
}

// Dev: app_kv by default; opt into keychain at runtime by setting
// `KNOYOO_USE_KEYCHAIN=1` in the environment. Useful for QAing the
// real keychain code path before packaging a release build:
//
//   KNOYOO_USE_KEYCHAIN=1 pnpm tauri:dev
//
// Reads the env var on every call (cheap) so the toggle is process-wide
// without having to restart anything dev-side.
#[cfg(all(not(test), debug_assertions))]
mod imp {
    use super::{app_kv_impl, keychain_impl, AppError};

    fn force_keychain() -> bool {
        std::env::var("KNOYOO_USE_KEYCHAIN").as_deref() == Ok("1")
    }

    pub fn get(account: &str) -> Result<Option<String>, AppError> {
        if force_keychain() {
            keychain_impl::get(account)
        } else {
            app_kv_impl::get(account)
        }
    }

    pub fn set(account: &str, value: &str) -> Result<(), AppError> {
        if force_keychain() {
            keychain_impl::set(account, value)
        } else {
            app_kv_impl::set(account, value)
        }
    }

    pub fn delete(account: &str) -> Result<(), AppError> {
        if force_keychain() {
            keychain_impl::delete(account)
        } else {
            app_kv_impl::delete(account)
        }
    }
}

#[cfg(test)]
mod imp {
    use super::AppError;
    use std::cell::RefCell;
    use std::collections::HashMap;

    thread_local! {
        // Per-thread so parallel cargo test runs never bleed into each
        // other. Each #[test] function runs on a fresh thread, which
        // gives us free isolation without touching the OS keychain.
        static STORE: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
    }

    pub fn get(account: &str) -> Result<Option<String>, AppError> {
        STORE.with(|s| Ok(s.borrow().get(account).cloned()))
    }

    pub fn set(account: &str, value: &str) -> Result<(), AppError> {
        STORE.with(|s| {
            s.borrow_mut().insert(account.to_string(), value.to_string());
        });
        Ok(())
    }

    pub fn delete(account: &str) -> Result<(), AppError> {
        STORE.with(|s| {
            s.borrow_mut().remove(account);
        });
        Ok(())
    }

    #[cfg(test)]
    pub fn reset() {
        STORE.with(|s| s.borrow_mut().clear());
    }
}

#[cfg(test)]
pub use imp::reset;

/// Delete every KnoYoo-owned keychain entry. Returns the number of
/// accounts it tried to remove. Safe to call when some entries don't
/// exist — each `delete` is already idempotent.
///
/// Exposed for the settings-page "重置所有密钥" button: a user whose
/// keychain ACL is in a weird state (e.g. dev builds with shifting code
/// signatures constantly reprompting) can hit this, then re-enter keys
/// to build a clean ACL owned by the current binary.
pub fn clear_all_knoyoo_secrets() -> Result<usize, AppError> {
    // Enumerate every known account. We don't ask the keychain for the
    // list (keyring crate has no listing API and the Security.framework
    // shape is gnarly); instead we iterate all accounts we ever create.
    // AI providers come from `ai.rs::SUPPORTED_AI_PROVIDERS`, ASR from
    // `transcribe.rs::SUPPORTED_PROVIDERS`. Kept in sync manually — if
    // someone adds a provider, they add its account here.
    const KNOWN_ACCOUNTS: &[&str] = &[
        "ai_deepseek",
        "ai_silicon",
        "ai_dashscope",
        "ai_zhipu",
        "ai_moonshot",
        "ai_ollama",
        "ai_openai",
        "ai_anthropic",
        "asr_openai",
        "asr_deepgram",
        "asr_siliconflow",
    ];
    for a in KNOWN_ACCOUNTS {
        delete(a)?;
    }
    Ok(KNOWN_ACCOUNTS.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_missing_entry_returns_none() {
        reset();
        assert_eq!(get("asr_missing").unwrap(), None);
    }

    #[test]
    fn set_then_get_roundtrips() {
        reset();
        set("asr_test", "sk-supersecret").unwrap();
        assert_eq!(get("asr_test").unwrap().as_deref(), Some("sk-supersecret"));
    }

    #[test]
    fn set_overwrites_previous_value() {
        reset();
        set("asr_test", "v1").unwrap();
        set("asr_test", "v2").unwrap();
        assert_eq!(get("asr_test").unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn delete_removes_entry() {
        reset();
        set("asr_test", "v1").unwrap();
        delete("asr_test").unwrap();
        assert_eq!(get("asr_test").unwrap(), None);
    }

    #[test]
    fn delete_missing_entry_is_ok() {
        reset();
        // Repeated deletes must be idempotent so callers can always try
        // "clear the slot" without having to probe first.
        delete("asr_never_existed").unwrap();
    }

    #[test]
    fn key_last_four_returns_tail() {
        assert_eq!(key_last_four("sk-1234567890abcd"), "abcd");
        assert_eq!(key_last_four("dg-token-wxyz"), "wxyz");
    }

    #[test]
    fn key_last_four_handles_cjk() {
        // 6-char string ending in "密钥" — char-based indexing matters here.
        assert_eq!(key_last_four("abcd密钥"), "cd密钥");
    }

    #[test]
    fn key_last_four_returns_empty_on_short_keys() {
        assert_eq!(key_last_four(""), "");
        assert_eq!(key_last_four("ab"), "");
        assert_eq!(key_last_four("abc"), "");
    }

    #[test]
    fn key_last_four_exactly_four_chars() {
        // Borderline case — exactly 4 chars returns the entire key.
        // Arguably leaky but also extremely unusual for a real API key.
        assert_eq!(key_last_four("abcd"), "abcd");
    }
}
