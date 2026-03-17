#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod coach;
mod db;
mod growth;
mod models;
mod notes;
mod onboarding;
mod plan;
mod tree;

fn init_logging() {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("desktop=info,warn"));

    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();
}

fn main() {
    init_logging();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            notes::add_note,
            notes::search_notes,
            notes::list_notes,
            notes::update_note,
            notes::delete_note,
            notes::export_notes_jsonl,
            notes::import_notes_jsonl,
            notes::count_notes,
            notes::list_note_contributions,
            notes::toggle_note_favorite,
            notes::list_favorite_notes,
            tree::seed_industry_v1,
            tree::list_industry_tree_v1,
            tree::list_skill_notes_v1,
            tree::save_custom_root_v1,
            tree::list_root_nodes_v1,
            tree::delete_root_and_subtree_v1,
            tree::clear_all_roots_v1,
            tree::ai_expand_node_v2,
            tree::save_industry_tree_v1,
            tree::list_saved_industry_trees_v1,
            tree::get_saved_industry_tree_v1,
            tree::delete_saved_industry_tree_v1,
            growth::fix_skill_name_unique,
            growth::fix_notes_delete_cascade,
            growth::debug_counts,
            plan::generate_plan,
            plan::list_plan_tasks,
            plan::update_plan_status,
            plan::delete_plan_task,
            plan::update_plan_task,
            plan::add_plan_task,
            plan::cleanup_plan_duplicates,
            plan::report_week_summary,
            plan::get_plan_goal,
            plan::set_plan_goal,
            plan::generate_plan_by_range,
            plan::ai_generate_plan_by_range,
            plan::create_plan_group,
            plan::list_plan_groups,
            plan::update_plan_group,
            plan::delete_plan_group,
            plan::list_plan_tasks_by_month,
            ai::get_ai_config,
            ai::set_ai_config,
            ai::ai_smoketest,
            ai::ai_chat,
            ai::ai_chat_with_context,
            ai::ai_generate_notes_from_file,
            db::check_db_health,
            // Onboarding & Coach
            onboarding::list_career_templates,
            onboarding::check_needs_onboarding,
            onboarding::mark_onboarded,
            onboarding::apply_career_template,
            onboarding::ai_generate_career_tree,
            onboarding::list_skill_progress,
            onboarding::ai_coach_weekly_report,
            onboarding::get_career_goal,
            onboarding::set_career_goal,
            // Coach enhancements
            coach::record_activity,
            coach::get_streak_info,
            coach::detect_ollama,
            coach::auto_configure_ollama,
            coach::get_daily_tip,
            coach::get_learning_stats,
            coach::export_skill_template,
            coach::import_skill_template,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
