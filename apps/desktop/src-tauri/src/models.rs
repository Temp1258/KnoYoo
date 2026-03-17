use serde::{Deserialize, Serialize};

// === Constants ===
pub const DEFAULT_MODEL: &str = "gpt-4o-mini";
pub const DEFAULT_PAGE_SIZE: u32 = 10;
pub const MAX_PAGE_SIZE: u32 = 100;

/// 用于返回的行业树节点
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndustryNode {
    pub id: i64,
    pub name: String,
    pub required_level: i64,
    pub importance: f64,
    pub children: Vec<IndustryNode>,
}

/// 用于返回节点关联的笔记
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SkillNote {
    pub id: i64,
    pub title: String,
    pub created_at: String,
    pub snippet: Option<String>,
}

#[derive(Serialize)]
pub struct Hit {
    pub id: i64,
    pub title: String,
    pub snippet: String,
}

#[derive(Serialize)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub is_favorite: bool,
}

/// 记录日期与数量，用于返回每天笔记贡献的统计结构体
#[derive(Serialize)]
pub struct DateCount {
    pub date: String,
    pub count: i64,
}


#[derive(Serialize)]
pub struct PlanTaskOut {
    pub id: i64,
    pub skill_id: Option<i64>,
    pub title: String,
    pub minutes: i64,
    pub due: Option<String>,
    pub status: String,
}

#[derive(Serialize)]
pub struct PlanTask {
    pub id: i64,
    pub skill_id: Option<i64>,
    pub title: String,
    pub minutes: i64,
    pub due: Option<String>,
    pub status: String,
    pub horizon: String,
    pub group_id: Option<i64>,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct PlanGroup {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct ExportResult {
    pub path: String,
    pub count: u32,
}

#[derive(Deserialize)]
pub struct InNote {
    pub title: String,
    pub content: String,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
pub struct WeekReport {
    pub start: String,
    pub end: String,
    pub tasks_done: i64,
    pub minutes_done: i64,
    pub new_notes: i64,
}

#[derive(Serialize)]
pub struct Counts {
    pub industry: i64,
    pub plans: i64,
}

/// 行业树快照概要
#[derive(Serialize, Deserialize)]
pub struct SavedTreeRow {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}


#[derive(Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// OpenAI-compatible chat completion response
#[derive(Debug, Deserialize)]
pub struct ChatCompletionResponse {
    pub choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
pub struct ChatChoice {
    pub message: ChatChoiceMessage,
}

#[derive(Debug, Deserialize)]
pub struct ChatChoiceMessage {
    pub content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_is_set() {
        assert_eq!(DEFAULT_MODEL, "gpt-4o-mini");
    }

    #[test]
    fn page_size_constants() {
        assert_eq!(DEFAULT_PAGE_SIZE, 10);
        assert_eq!(MAX_PAGE_SIZE, 100);
        assert!(DEFAULT_PAGE_SIZE <= MAX_PAGE_SIZE);
    }
}
