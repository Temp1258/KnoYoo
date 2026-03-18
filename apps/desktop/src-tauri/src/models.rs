use serde::{Deserialize, Serialize};

// === Constants ===
pub const DEFAULT_MODEL: &str = "deepseek-chat";
pub const DEFAULT_PAGE_SIZE: u32 = 10;
pub const MAX_PAGE_SIZE: u32 = 100;

// Progress calculation weights
/// Weight of task completion in overall skill progress (0.0 ~ 1.0)
pub const PROGRESS_TASK_WEIGHT: f64 = 0.7;
/// Weight of note activity in overall skill progress (0.0 ~ 1.0)
pub const PROGRESS_NOTE_WEIGHT: f64 = 0.3;
/// Number of notes that represent maximum note signal
pub const PROGRESS_NOTE_MAX: f64 = 5.0;
/// Progress threshold to consider a skill "mastered"
pub const PROGRESS_MASTERED_THRESHOLD: f64 = 0.8;

// AI context limits
/// Maximum characters to send from a file to AI for note extraction
pub const AI_FILE_CHAR_LIMIT: usize = 8000;
/// Maximum skills AI can return for classification
pub const AI_SKILL_PICK_LIMIT: usize = 8;
/// Max items for radar chart display
pub const RADAR_MAX_ITEMS: usize = 8;

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

/// Calculate skill progress from task completion and note count.
/// Returns a value between 0.0 and 1.0.
pub fn calc_skill_progress(done_tasks: i64, total_tasks: i64, note_count: i64) -> f64 {
    let task_progress = if total_tasks > 0 {
        done_tasks as f64 / total_tasks as f64
    } else {
        0.0
    };
    let note_signal = (note_count as f64 / PROGRESS_NOTE_MAX).min(1.0);
    (task_progress * PROGRESS_TASK_WEIGHT + note_signal * PROGRESS_NOTE_WEIGHT).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_is_set() {
        assert_eq!(DEFAULT_MODEL, "deepseek-chat");
    }

    #[test]
    fn page_size_constants() {
        assert_eq!(DEFAULT_PAGE_SIZE, 10);
        assert_eq!(MAX_PAGE_SIZE, 100);
        assert!(DEFAULT_PAGE_SIZE <= MAX_PAGE_SIZE);
    }

    #[test]
    fn progress_weights_sum_to_one() {
        let sum = PROGRESS_TASK_WEIGHT + PROGRESS_NOTE_WEIGHT;
        assert!((sum - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn calc_progress_zero_when_no_data() {
        assert_eq!(calc_skill_progress(0, 0, 0), 0.0);
    }

    #[test]
    fn calc_progress_full_tasks_no_notes() {
        let p = calc_skill_progress(10, 10, 0);
        assert!((p - PROGRESS_TASK_WEIGHT).abs() < f64::EPSILON);
    }

    #[test]
    fn calc_progress_no_tasks_max_notes() {
        let p = calc_skill_progress(0, 0, 10);
        assert!((p - PROGRESS_NOTE_WEIGHT).abs() < f64::EPSILON);
    }

    #[test]
    fn calc_progress_capped_at_one() {
        let p = calc_skill_progress(100, 100, 100);
        assert!(p <= 1.0);
    }
}
