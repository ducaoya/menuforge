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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_entries,
            set_entry_enabled,
            delete_entry,
            create_entry,
            set_entry_icon,
            load_icons,
            set_many_enabled,
            delete_many,
            cleanup_invalid,
            list_backups,
            restore_backup,
            win11_classic,
            set_win11_classic,
            is_admin,
            relaunch_as_admin
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
