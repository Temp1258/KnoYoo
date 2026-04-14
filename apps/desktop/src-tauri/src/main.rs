#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod ai_client;
mod bilibili;
mod books;
mod clip_server;
mod clips;
mod collections;
mod db;
mod export;
mod import;
mod error;
mod html_extract;
mod models;
mod youtube;

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

    // Nudge any books that are stuck in "pending" AI analysis (crashed during
    // a prior run, or just had their legacy bad metadata cleared by a
    // migration) so the user doesn't have to manually retry each one.
    books::resume_pending_ai_extraction();

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
            // AI
            ai::get_ai_config,
            ai::set_ai_config,
            ai::ai_smoketest,
            ai::ai_chat,
            ai::ai_chat_with_context,
            ai::ai_suggest_actions,
            ai::detect_ollama,
            ai::auto_configure_ollama,
            // Database
            db::check_db_health,
            db::get_database_info,
            // Web Clips
            clips::mark_clip_read,
            clips::toggle_read_clip,
            clips::add_web_clip,
            clips::get_clip,
            clips::list_web_clips,
            clips::search_web_clips,
            clips::delete_web_clip,
            clips::toggle_star_clip,
            clips::update_web_clip,
            clips::count_web_clips,
            clips::count_pending_clips,
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
            clips::get_app_status,
            clips::set_onboarding_complete,
            clips::get_weekly_stats,
            clips::find_related_clips,
            clips::save_clip_note,
            clips::get_clip_note,
            clips::delete_clip_note,
            // Trash / Recycle bin
            clips::list_trash,
            clips::restore_clip,
            clips::purge_clip,
            clips::empty_trash,
            clips::count_trash,
            // Chat sessions
            clips::create_chat_session,
            clips::list_chat_sessions,
            clips::update_chat_session,
            clips::delete_chat_session,
            // Collections
            collections::create_collection,
            collections::update_collection,
            collections::delete_collection,
            collections::list_collections,
            collections::get_collection,
            collections::add_clip_to_collection,
            collections::remove_clip_from_collection,
            collections::list_collection_clips,
            collections::list_clip_collections,
            // Export / Backup
            export::export_clip_to_file,
            export::export_collection_to_dir,
            export::export_full_database,
            export::import_full_database,
            // Import
            import::parse_bookmark_file,
            import::import_bookmarks,
            // Clip server
            clip_server::get_clip_server_token,
            clip_server::get_clip_server_port,
            // Books
            books::add_book,
            books::list_books,
            books::get_book,
            books::update_book,
            books::delete_book,
            books::restore_book,
            books::purge_book,
            books::list_books_trash,
            books::count_books_trash,
            books::empty_books_trash,
            books::count_books,
            books::set_book_cover,
            books::read_book_cover,
            books::open_book_externally,
            books::ai_extract_book_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
