#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod ai_client;
mod asr_client;
mod audio;
mod audio_split;
mod bilibili;
mod books;
mod clip_server;
mod clips;
mod db;
mod doc_extract;
mod documents;
mod export;
mod import;
mod error;
mod html_extract;
mod media;
mod milestones;
mod models;
mod search;
mod secrets;
mod shortcut;
mod transcribe;
mod youtube;
mod ytdlp;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::ShortcutState;

fn init_logging() {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("desktop=info,warn"));

    fmt().with_env_filter(filter).with_target(true).init();
}

/// Stable window label for the overlay. Shared by the Rust setup path and
/// every show/hide call so the frontend can identify itself via
/// `getCurrentWindow().label === QUICK_SEARCH_WINDOW`.
const QUICK_SEARCH_WINDOW: &str = "quick-search";

/// Toggle the quick-search overlay. Idempotent — safe to call repeatedly.
/// When showing, emits a `quick-search://shown` event so the overlay JS can
/// reset its input state and refocus.
fn toggle_quick_search(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window(QUICK_SEARCH_WINDOW) else {
        tracing::warn!("quick-search window not built yet");
        return;
    };
    match win.is_visible() {
        Ok(true) => {
            let _ = win.hide();
        }
        Ok(false) => {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
            // Notify JS so it can refocus the input and clear stale state.
            let _ = app.emit("quick-search://shown", ());
        }
        Err(e) => tracing::warn!("quick-search visibility check failed: {e}"),
    }
}

fn main() {
    init_logging();

    // Start local HTTP server for browser extension communication
    clip_server::start_server();

    // First-run milestone backfill. Runs off the main thread because the
    // SQL touches web_clips/books which might be large on upgrade; no user
    // interaction waits on it. Subsequent launches short-circuit on the
    // `milestones_backfilled` app_kv flag.
    std::thread::spawn(|| {
        if let Err(e) = milestones::first_run_backfill() {
            tracing::warn!("milestone backfill failed: {e}");
        }
    });

    // We deliberately do NOT auto-resume pending book AI analyses on
    // startup. That path reads the OS keychain to fetch the AI provider
    // key, which triggers a macOS auth prompt before the user has even
    // touched the app. If a book is stuck in 'pending', the books page
    // shows a "让 AI 分析" button per card that the user can click
    // themselves — the trigger then happens in response to an explicit
    // user action, which is the only time keychain access should
    // surprise them with a prompt.

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // We only register one global shortcut (quick-search), so
                    // any press we see is that one. Binding matching lives in
                    // `shortcut.rs` via register/unregister, not by comparing
                    // ids here — it avoids syncing a static accelerator list.
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    toggle_quick_search(app);
                })
                .build(),
        )
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

            // Quick-search overlay window. Built hidden at startup so the
            // first shortcut press shows it instantly rather than waiting
            // on webview creation. Same webview URL as main — the frontend
            // branches on `getCurrentWindow().label` to render the overlay
            // instead of the full app shell.
            let overlay = WebviewWindowBuilder::new(
                app,
                QUICK_SEARCH_WINDOW,
                WebviewUrl::App("index.html".into()),
            )
            .title("KnoYoo 快速搜索")
            .inner_size(640.0, 440.0)
            .min_inner_size(480.0, 320.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .center()
            .build()?;
            // Hiding the window on blur gives Spotlight-like behavior: the
            // overlay disappears as soon as the user clicks away.
            let overlay_handle = overlay.clone();
            overlay.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    let _ = overlay_handle.hide();
                }
            });

            // Register the user's configured shortcut (or platform default
            // if unset). Failure to register is non-fatal — shortcut::
            // register_initial logs a warning and the user can rebind from
            // Settings.
            shortcut::register_initial(app.handle());

            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept close button → hide to tray instead of quitting.
            // The overlay also uses this to close-to-hide, which is what we
            // want since the overlay is long-lived and hidden by default.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // AI
            ai::get_ai_config,
            ai::set_ai_config,
            ai::reset_api_keys,
            ai::sync_dual_role_key,
            ai::ai_smoketest,
            ai::ai_chat_with_context,
            ai::detect_ollama,
            // Database
            db::check_db_health,
            db::get_database_info,
            db::restart_app,
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
            clips::ai_translate_clip,
            clips::ai_batch_retag_clips,
            clips::check_clip_exists,
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
            // Export / Backup
            export::export_clip_to_file,
            export::export_media_item_to_file,
            export::export_document_to_file,
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
            // Video → transcript pipeline
            transcribe::import_video_clip,
            transcribe::retry_transcription,
            transcribe::get_asr_config,
            transcribe::set_asr_config,
            // Local audio & video file import (podcasts, recordings, MP4s)
            audio::import_audio_file,
            audio::import_local_video_file,
            // media_items: post-import CRUD + manual pipeline triggers
            media::list_media_items,
            media::get_media_item,
            media::count_media_items,
            media::toggle_star_media_item,
            media::toggle_read_media_item,
            media::mark_media_item_read,
            media::update_media_item,
            media::save_media_item_notes,
            media::delete_media_item,
            media::restore_media_item,
            media::purge_media_item,
            media::list_media_trash,
            media::count_media_trash,
            media::empty_media_trash,
            media::retry_media_transcription,
            media::ai_auto_tag_media_item,
            media::ai_translate_media_item,
            // documents (Phase C): local text-file uploads
            documents::import_document,
            documents::list_documents,
            documents::get_document,
            documents::count_documents,
            documents::toggle_star_document,
            documents::toggle_read_document,
            documents::mark_document_read,
            documents::update_document,
            documents::save_document_notes,
            documents::delete_document,
            documents::restore_document,
            documents::purge_document,
            documents::list_document_trash,
            documents::count_document_trash,
            documents::empty_document_trash,
            documents::retry_document_ai,
            documents::ai_auto_tag_document,
            documents::convert_document_to_book,
            documents::convert_book_to_document,
            // Milestones
            milestones::list_milestones,
            milestones::acknowledge_milestone,
            milestones::acknowledge_all_milestones,
            // Unified cross-content search
            search::unified_search,
            // Global shortcut (user-configurable)
            shortcut::get_quick_search_shortcut,
            shortcut::set_quick_search_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
