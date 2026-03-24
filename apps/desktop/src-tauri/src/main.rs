#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod ai_client;
mod clip_server;
mod clips;
mod coach;
mod db;
mod error;
mod models;
mod notes;
mod onboarding;
mod plan;
mod tree;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn init_logging() {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("desktop=info,warn"));

    fmt().with_env_filter(filter).with_target(true).init();
}

fn main() {
    init_logging();

    // Start local HTTP server for browser extension communication
    clip_server::start_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Build tray right-click menu
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 KnoYoo", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Create system tray icon
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("KnoYoo - 知识管理助手")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on tray icon → show window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept close button → hide to tray instead of quitting
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
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
            coach::export_learning_markdown,
            coach::get_share_card_data,
            coach::ai_skill_gap_analysis,
            coach::list_gallery_templates,
            // Web Clips
            clips::add_web_clip,
            clips::list_web_clips,
            clips::search_web_clips,
            clips::delete_web_clip,
            clips::toggle_star_clip,
            clips::count_web_clips,
            clips::list_clip_tags,
            clips::ai_auto_tag_clip,
            clips::ai_batch_retag_clips,
            clips::check_clip_exists,
            clips::find_similar_clips,
            clips::ai_fuzzy_search_clips,
            clips::list_web_clips_advanced,
            clips::list_clip_domains,
            clips::forgotten_clips,
            clips::ai_weekly_clip_summary,
            clips::clip_to_note,
            clips::suggest_skill_from_clips,
            clip_server::get_clip_server_token,
            clip_server::get_clip_server_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
