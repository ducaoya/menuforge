mod icons;
pub mod registry;

use registry::{BackupInfo, Entry, NewEntry, Target};
use std::collections::HashMap;

#[tauri::command]
fn list_entries() -> Vec<Entry> {
    registry::list_entries()
}

#[tauri::command]
fn set_entry_enabled(target: Target, enabled: bool) -> Result<(), String> {
    registry::set_enabled(&target, enabled)
}

#[tauri::command]
fn delete_entry(target: Target) -> Result<(), String> {
    registry::delete_entry(&target)
}

#[tauri::command]
fn create_entry(entry: NewEntry) -> Result<(), String> {
    registry::create_entry(&entry)
}

#[tauri::command]
fn set_entry_icon(target: Target, icon: String) -> Result<(), String> {
    registry::set_icon(&target, &icon)
}

#[tauri::command]
fn load_icons(keys: Vec<String>) -> HashMap<String, String> {
    registry::load_icons(&keys)
}

#[tauri::command]
fn icons_in_file(path: String) -> Vec<icons::IconItem> {
    icons::icons_in_file(&path, 120)
}

#[tauri::command]
fn pick_icon_file(window: tauri::Window) -> Option<String> {
    let hwnd = window.hwnd().map(|h| h.0 as *mut core::ffi::c_void).unwrap_or(std::ptr::null_mut());
    icons::pick_file(hwnd)
}

#[tauri::command]
fn set_many_enabled(targets: Vec<Target>, enabled: bool) -> Vec<String> {
    registry::set_many_enabled(&targets, enabled)
}

#[tauri::command]
fn delete_many(targets: Vec<Target>) -> Vec<String> {
    registry::delete_many(&targets)
}

#[tauri::command]
fn cleanup_invalid() -> (usize, Vec<String>) {
    registry::cleanup_invalid()
}

#[tauri::command]
fn list_backups() -> Vec<BackupInfo> {
    registry::list_backups()
}

#[tauri::command]
fn restore_backup(file: String) -> Result<(), String> {
    registry::restore_backup(&file)
}

#[tauri::command]
fn delete_backup(file: String) -> Result<(), String> {
    registry::delete_backup(&file)
}

#[tauri::command]
fn win11_classic() -> bool {
    registry::win11_classic()
}

#[tauri::command]
fn set_win11_classic(enabled: bool) -> Result<(), String> {
    registry::set_win11_classic(enabled)
}

#[tauri::command]
fn is_admin() -> bool {
    registry::is_admin()
}

#[tauri::command]
fn relaunch_as_admin() -> Result<(), String> {
    registry::relaunch_as_admin()
}

#[cfg(windows)]
fn tune_window(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
    };
    // 系统圆角/边框与 CSS 圆角打架，全部交给 CSS，这里关掉
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;
    if let Ok(hwnd) = window.hwnd() {
        let h = hwnd.0 as *mut c_void;
        unsafe {
            let preferred: u32 = DWMWCP_DONOTROUND;
            DwmSetWindowAttribute(
                h,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                &preferred as *const _ as *const c_void,
                4,
            );
            let border: u32 = DWMWA_COLOR_NONE;
            DwmSetWindowAttribute(
                h,
                DWMWA_BORDER_COLOR as u32,
                &border as *const _ as *const c_void,
                4,
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    tune_window(&w);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_entries,
            set_entry_enabled,
            delete_entry,
            create_entry,
            set_entry_icon,
            load_icons,
            icons_in_file,
            pick_icon_file,
            set_many_enabled,
            delete_many,
            cleanup_invalid,
            list_backups,
            restore_backup,
            delete_backup,
            win11_classic,
            set_win11_classic,
            is_admin,
            relaunch_as_admin
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
