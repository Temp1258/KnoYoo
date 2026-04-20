//! User-configurable global shortcut for the `QuickSearch` overlay.
//!
//! Storage: the selected accelerator is kept as a string in `app_kv` under
//! `quick_search_shortcut` (e.g. "CmdOrCtrl+Shift+K"). On startup
//! `register_initial` reads that value, falls back to the platform default,
//! and registers with `tauri-plugin-global-shortcut`.
//!
//! Live updates: `set_quick_search_shortcut` unregisters the previous
//! accelerator, parses+registers the new one, persists to `app_kv`, and
//! atomically swaps the `CURRENT` cell. All under a single mutex so two
//! settings writes in quick succession can't race.
//!
//! Failure modes surfaced to the UI:
//!   - `"快捷键格式非法"` — user input doesn't parse as an accelerator
//!   - `"快捷键已被其他应用占用"` — OS refused registration (another app
//!     grabbed the combination first)
//!
//! Both leave the previous shortcut intact so the user can retry without
//! losing their working hotkey.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::{kv_get, open_db, set_kv};

/// Platform default. SUPER maps to Cmd on macOS; elsewhere this string parses
/// to Ctrl+Shift+K via Tauri's accelerator grammar.
#[cfg(target_os = "macos")]
pub const DEFAULT_ACCELERATOR: &str = "Cmd+Shift+K";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_ACCELERATOR: &str = "Ctrl+Shift+K";

const KV_KEY: &str = "quick_search_shortcut";

/// Tracks the accelerator currently registered with the OS so `set_…` can
/// unregister it before swapping in a new one. `None` = nothing registered
/// (e.g. initial registration failed and user hasn't corrected it yet).
static CURRENT: Mutex<Option<Shortcut>> = Mutex::new(None);

/// Read the user's configured accelerator from `app_kv`, falling back to the
/// platform default when unset or empty.
pub fn current_accelerator() -> String {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return DEFAULT_ACCELERATOR.to_string(),
    };
    match kv_get(&conn, KV_KEY) {
        Ok(Some(v)) if !v.trim().is_empty() => v,
        _ => DEFAULT_ACCELERATOR.to_string(),
    }
}

fn parse(accelerator: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(accelerator.trim())
        .map_err(|e| format!("快捷键格式非法：{e}"))
}

/// Called once from `main.rs::setup` after the plugin is initialized. On
/// failure this logs a warning but never aborts startup — the user can
/// still rebind from Settings.
pub fn register_initial(app: &AppHandle) {
    let accel = current_accelerator();
    match parse(&accel).and_then(|s| {
        app.global_shortcut()
            .register(s)
            .map(|()| s)
            .map_err(|e| format!("注册失败：{e}"))
    }) {
        Ok(sc) => {
            *CURRENT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(sc);
            tracing::info!("quick-search shortcut registered: {accel}");
        }
        Err(e) => {
            tracing::warn!("quick-search shortcut '{accel}' registration failed: {e}");
        }
    }
}

#[tauri::command]
pub fn get_quick_search_shortcut() -> Result<String, String> {
    Ok(current_accelerator())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn set_quick_search_shortcut(
    app: AppHandle,
    accelerator: String,
) -> Result<(), String> {
    // Parse first so a bad string never causes an unregister.
    let next = parse(&accelerator)?;

    // Hold the lock across unregister+register so two concurrent calls can't
    // interleave and leave the OS registration out of sync with CURRENT.
    let mut guard = CURRENT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    // Same accelerator as what's already bound — no-op. Saves a round of
    // unregister/register that would briefly leave the user with no hotkey.
    if guard.as_ref() == Some(&next) {
        let conn = open_db()?;
        set_kv(&conn, KV_KEY, accelerator.trim())?;
        return Ok(());
    }

    let shortcuts = app.global_shortcut();
    if let Some(old) = *guard {
        if let Err(e) = shortcuts.unregister(old) {
            tracing::warn!("quick-search unregister old shortcut failed: {e}");
            // Keep going — if the OS lost track of our registration we still
            // want to let the user set a new one.
        }
    }
    shortcuts
        .register(next)
        .map_err(|e| format!("快捷键已被其他应用占用：{e}"))?;

    *guard = Some(next);
    drop(guard);

    // Persist only after the OS accepted it. A failed register won't poison
    // the kv with a non-working value.
    let conn = open_db()?;
    set_kv(&conn, KV_KEY, accelerator.trim())?;
    tracing::info!("quick-search shortcut updated to {accelerator}");
    Ok(())
}
