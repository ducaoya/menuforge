use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use winreg::enums::*;
use winreg::RegKey;

const CLASSES: &str = "Software\\Classes";
const BLOCKED: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked";
const WIN11_CLSID: &str = "Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}";

pub const SCOPES: &[(&str, &str)] = &[
    ("file", "*"),
    ("directory", "Directory"),
    ("background", "Directory\\Background"),
    ("drive", "Drive"),
    ("desktop", "DesktopBackground"),
    ("folder", "Folder"),
    ("all", "AllFilesystemObjects"),
];

fn hive_key(hive: &str) -> RegKey {
    match hive {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        _ => RegKey::predef(HKEY_CURRENT_USER),
    }
}

fn read_flags() -> u32 {
    KEY_READ | KEY_WOW64_64KEY
}

fn write_flags() -> u32 {
    KEY_READ | KEY_WRITE | KEY_WOW64_64KEY
}

fn open(hive: &str, rel: &str) -> std::io::Result<RegKey> {
    hive_key(hive).open_subkey_with_flags(format!("{CLASSES}\\{rel}"), read_flags())
}

fn value_str(key: &RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name).ok()
}

pub fn is_admin() -> bool {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("Software", KEY_WRITE)
        .is_ok()
}

/* ---------- indirect string resolution ("@shell32.dll,-8506") ---------- */

fn resolve_indirect(raw: &str) -> String {
    let trimmed = raw.trim();
    if !trimmed.starts_with('@') {
        return trimmed.to_string();
    }
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = OsStr::new(trimmed).encode_wide().chain(Some(0)).collect();
        let mut out = [0u16; 512];
        let hr = unsafe {
            windows_sys::Win32::UI::Shell::SHLoadIndirectString(
                wide.as_ptr(),
                out.as_mut_ptr(),
                out.len() as u32,
                std::ptr::null_mut(),
            )
        };
        if hr >= 0 {
            let len = out.iter().position(|&c| c == 0).unwrap_or(0);
            if len > 0 {
                return String::from_utf16_lossy(&out[..len]);
            }
        }
    }
    trimmed.to_string()
}

/* ---------- blocked-list handling for shell extension handlers ---------- */

fn blocked_set(hive: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(k) = hive_key(hive).open_subkey_with_flags(BLOCKED, read_flags()) {
        for item in k.enum_values() {
            if let Ok((name, _)) = item {
                out.push(name);
            }
        }
    }
    out
}

fn set_blocked(hive: &str, clsid: &str, block: bool) -> Result<(), String> {
    let (key, _) = hive_key(hive)
        .create_subkey_with_flags(BLOCKED, KEY_ALL_ACCESS)
        .map_err(|e| e.to_string())?;
    if block {
        key.set_value(clsid, &"")
            .map_err(|e| format!("写入拦截列表失败（可能需要管理员权限）：{e}"))
    } else {
        match key.delete_value(clsid) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/* ---------- value snapshots (byte-exact backup) ---------- */

#[derive(Serialize, Deserialize, Clone)]
pub struct RawValue {
    pub name: String,
    pub vtype: u32,
    pub data: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct KeySnapshot {
    pub values: Vec<RawValue>,
    pub subkeys: Vec<SubKeySnapshot>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SubKeySnapshot {
    pub name: String,
    pub node: KeySnapshot,
}

fn snapshot(key: &RegKey) -> KeySnapshot {
    let mut values = Vec::new();
    for item in key.enum_values() {
        if let Ok((name, val)) = item {
            values.push(RawValue {
                name,
                vtype: val.vtype as u32,
                data: val.bytes.to_vec(),
            });
        }
    }
    let mut subkeys = Vec::new();
    for item in key.enum_keys() {
        if let Ok(name) = item {
            if let Ok(sub) = key.open_subkey_with_flags(&name, read_flags()) {
                subkeys.push(SubKeySnapshot {
                    name,
                    node: snapshot(&sub),
                });
            }
        }
    }
    KeySnapshot { values, subkeys }
}

fn restore(key: &RegKey, node: &KeySnapshot) -> Result<(), String> {
    for v in &node.values {
        let raw = winreg::RegValue {
            bytes: v.data.clone(),
            vtype: v.vtype_to_enum(),
        };
        key.set_raw_value(&v.name, &raw).map_err(|e| e.to_string())?;
    }
    for sub in &node.subkeys {
        let child = key
            .create_subkey_with_flags(&sub.name, KEY_ALL_ACCESS)
            .map_err(|e| e.to_string())?;
        restore(&child.0, &sub.node)?;
    }
    Ok(())
}

impl RawValue {
    fn vtype_to_enum(&self) -> RegType {
        match self.vtype {
            1 => REG_SZ,
            2 => REG_EXPAND_SZ,
            3 => REG_BINARY,
            4 => REG_DWORD,
            5 => REG_DWORD_BIG_ENDIAN,
            6 => REG_LINK,
            7 => REG_MULTI_SZ,
            11 => REG_QWORD,
            _ => REG_NONE,
        }
    }
}

/* ---------- entry model ---------- */

#[derive(Serialize, Clone)]
pub struct Entry {
    pub hive: String,
    pub path: String,
    pub kind: String,
    pub name: String,
    pub scope: String,
    pub title: String,
    pub command: String,
    pub icon: String,
    pub icon_key: String,
    pub enabled: bool,
    pub clsid: String,
    pub shift_only: bool,
    pub needs_admin: bool,
    pub submenu: bool,
    pub writable: bool,
    pub valid: bool,
    pub invalid_reason: String,
}

fn prettify(name: &str) -> String {
    if !name.chars().any(|c| c.is_ascii_uppercase()) || name.contains(' ') {
        return name.to_string();
    }
    let mut out = String::with_capacity(name.len() + 4);
    for (i, ch) in name.char_indices() {
        if i > 0 && ch.is_ascii_uppercase() {
            out.push(' ');
        }
        out.push(ch);
    }
    out
}

fn clsid_title(clsid: &str) -> Option<String> {
    if clsid.is_empty() {
        return None;
    }
    for hive in ["HKLM", "HKCU"] {
        if let Ok(key) = open(hive, &format!("CLSID\\{clsid}")) {
            let raw = value_str(&key, "")
                .or_else(|| value_str(&key, "LocalizedString"))
                .unwrap_or_default();
            let text = resolve_indirect(&raw);
            let text = text.trim().to_string();
            if !text.is_empty() && !text.starts_with('{') {
                return Some(text);
            }
        }
    }
    None
}

fn default_icon(clsid: &str) -> Option<String> {
    if clsid.is_empty() {
        return None;
    }
    for hive in ["HKLM", "HKCU"] {
        if let Ok(key) = open(hive, &format!("CLSID\\{clsid}\\DefaultIcon")) {
            if let Some(v) = value_str(&key, "") {
                return Some(v);
            }
        }
    }
    None
}

fn clsid_dll(clsid: &str) -> Option<String> {
    if clsid.is_empty() {
        return None;
    }
    for hive in ["HKLM", "HKCU"] {
        if let Ok(key) = open(hive, &format!("CLSID\\{clsid}\\InprocServer32")) {
            if let Some(v) = value_str(&key, "") {
                if !v.trim().is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn icon_source(icon_value: &str, command: &str, clsid: &str, kind: &str) -> Option<(String, i32)> {
    if let Some(pair) = crate::icons::parse_spec(icon_value) {
        return Some(pair);
    }
    if kind == "handler" {
        if let Some(spec) = default_icon(clsid) {
            if let Some(pair) = crate::icons::parse_spec(&spec) {
                return Some(pair);
            }
        }
        // 扩展自身 DLL 的第 0 个图标
        if let Some(dll) = clsid_dll(clsid) {
            if let Some(pair) = crate::icons::parse_spec(&dll) {
                return Some(pair);
            }
        }
    }
    crate::icons::command_exe(command).map(|exe| (exe, 0))
}

fn validate(
    kind: &str,
    command: &str,
    clsid: &str,
    submenu: bool,
    modern: bool,
) -> Option<String> {
    if kind == "handler" {
        if clsid.is_empty() {
            return Some("无法识别扩展 CLSID".into());
        }
        let registered = ["HKLM", "HKCU"]
            .iter()
            .any(|h| open(h, &format!("CLSID\\{clsid}")).is_ok());
        if !registered {
            return Some("扩展未注册（CLSID 缺失）".into());
        }
        return None;
    }
    if modern || submenu {
        return None;
    }
    if command.trim().is_empty() {
        return Some("缺少 command 子项".into());
    }
    let target = crate::icons::first_token(command);
    if target.is_empty() {
        return Some("命令为空".into());
    }
    if crate::icons::command_exe(command).is_none() {
        return Some(format!("程序不存在：{target}"));
    }
    None
}

fn build_entry(hive: &str, scope: &str, rel: &str, kind: &str, name: &str, admin: bool) -> Option<Entry> {
    let key = open(hive, rel).ok()?;
    let mut command = String::new();
    let mut icon = String::new();
    let mut delegated = false;
    let clsid;
    let mut title;

    if kind == "verb" {
        title = value_str(&key, "MUIVerb")
            .or_else(|| value_str(&key, ""))
            .unwrap_or_else(|| name.to_string());
        if let Ok(cmd) = open(hive, &format!("{rel}\\command")) {
            command = value_str(&cmd, "").unwrap_or_default();
            delegated = cmd.get_raw_value("DelegateExecute").is_ok()
                || cmd.get_raw_value("ExplorerCommandHandler").is_ok();
        }
        icon = value_str(&key, "Icon").unwrap_or_default();
        clsid = value_str(&key, "CLSID").unwrap_or_default();
    } else {
        title = value_str(&key, "").unwrap_or_else(|| name.to_string());
        clsid = if name.starts_with('{') {
            name.to_string()
        } else if title.starts_with('{') {
            title.clone()
        } else {
            String::new()
        };
        if title.starts_with('@') || title.starts_with('{') {
            title = name.to_string();
        }
    }

    title = resolve_indirect(&title);
    if title.trim().is_empty() {
        title = name.to_string();
    }
    if title == name || title.starts_with('{') {
        if let Some(better) = clsid_title(&clsid) {
            title = better;
        }
    }
    if title == name {
        title = prettify(name);
    }

    let enabled = if kind == "verb" {
        key.get_raw_value("LegacyDisable").is_err()
    } else if clsid.is_empty() {
        true
    } else {
        !blocked_set("HKCU").contains(&clsid) && !blocked_set("HKLM").contains(&clsid)
    };

    let submenu = key.get_raw_value("SubCommands").is_ok()
        || key.get_raw_value("ExtendedSubCommandsKey").is_ok()
        || key.open_subkey("shell").is_ok();
    let has_clsid_subkey = key.enum_keys().flatten().any(|sub| sub.trim_start().starts_with('{'));
    let drag_only = key.open_subkey("DropTarget").is_ok()
        || key.get_raw_value("ProgrammaticAccessOnly").is_ok();
    let modern = delegated
        || drag_only
        || key.get_raw_value("ExplorerCommandHandler").is_ok()
        || key.get_raw_value("DelegateExecute").is_ok()
        || !clsid.is_empty()
        || has_clsid_subkey;

    let icon_key = icon_source(&icon, &command, &clsid, kind)
        .map(|(p, i)| crate::icons::key(&p, i))
        .unwrap_or_default();
    let invalid = validate(kind, &command, &clsid, submenu, modern);

    Some(Entry {
        hive: hive.to_string(),
        path: rel.to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        scope: scope.to_string(),
        title,
        command: command.clone(),
        icon,
        icon_key,
        enabled,
        clsid,
        shift_only: key.get_raw_value("Extended").is_ok(),
        needs_admin: command.to_lowercase().contains("runas"),
        submenu,
        writable: admin || hive == "HKCU",
        valid: invalid.is_none(),
        invalid_reason: invalid.unwrap_or_default(),
    })
}

pub fn list_entries() -> Vec<Entry> {
    let admin = is_admin();
    let mut out: Vec<Entry> = Vec::new();
    for (scope, base) in SCOPES {
        for hive in ["HKCU", "HKLM"] {
            let verbs_path = format!("{base}\\shell");
            if let Ok(key) = open(hive, &verbs_path) {
                for item in key.enum_keys() {
                    if let Ok(name) = item {
                        let rel = format!("{verbs_path}\\{name}");
                        if let Some(e) = build_entry(hive, scope, &rel, "verb", &name, admin) {
                            out.push(e);
                        }
                    }
                }
            }
            let handlers_path = format!("{base}\\shellex\\ContextMenuHandlers");
            if let Ok(key) = open(hive, &handlers_path) {
                for item in key.enum_keys() {
                    if let Ok(name) = item {
                        let rel = format!("{handlers_path}\\{name}");
                        if let Some(e) = build_entry(hive, scope, &rel, "handler", &name, admin) {
                            out.push(e);
                        }
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    out
}

/* ---------- mutations ---------- */

#[derive(Deserialize)]
pub struct Target {
    pub hive: String,
    pub path: String,
    pub kind: String,
    pub name: String,
    pub clsid: String,
}

pub fn set_enabled(t: &Target, enabled: bool) -> Result<(), String> {
    if t.kind == "handler" {
        if t.clsid.is_empty() {
            return Err("该扩展没有 CLSID，无法切换".into());
        }
        return set_blocked(&t.hive, &t.clsid, !enabled);
    }
    let key = hive_key(&t.hive)
        .open_subkey_with_flags(format!("{CLASSES}\\{}", t.path), write_flags())
        .map_err(|e| format!("打开注册表项失败（HKLM 需要管理员权限）：{e}"))?;
    if enabled {
        match key.delete_value("LegacyDisable") {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        key.set_value("LegacyDisable", &"")
            .map_err(|e| format!("写入注册表失败：{e}"))
    }
}

fn backup_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("MenuForge").join("backups")
}

#[derive(Serialize)]
pub struct BackupInfo {
    pub file: String,
    pub title: String,
    pub path: String,
    pub created: u64,
}

#[derive(Serialize, Deserialize)]
struct BackupDoc {
    title: String,
    hive: String,
    path: String,
    node: KeySnapshot,
}

pub fn delete_entry(t: &Target) -> Result<(), String> {
    let key = hive_key(&t.hive)
        .open_subkey_with_flags(format!("{CLASSES}\\{}", t.path), read_flags())
        .map_err(|e| format!("打开注册表项失败：{e}"))?;
    let node = snapshot(&key);

    let dir = backup_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let safe_name: String = t
        .name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let file = dir.join(format!("{ts}-{}.json", safe_name));
    let doc = BackupDoc {
        title: t.name.clone(),
        hive: t.hive.clone(),
        path: t.path.clone(),
        node,
    };
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(&file, text).map_err(|e| e.to_string())?;

    let parent = t.path.rsplit_once('\\').map(|(p, _)| p).unwrap_or("");
    hive_key(&t.hive)
        .open_subkey_with_flags(format!("{CLASSES}\\{parent}"), write_flags())
        .map_err(|e| format!("打开父项失败（HKLM 需要管理员权限）：{e}"))?
        .delete_subkey_all(&t.name)
        .map_err(|e| format!("删除失败：{e}"))
}

pub fn list_backups() -> Vec<BackupInfo> {
    let dir = backup_dir();
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for item in rd.flatten() {
            let file = item.file_name().to_string_lossy().to_string();
            if !file.ends_with(".json") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(item.path()) else { continue };
            let Ok(doc) = serde_json::from_str::<BackupDoc>(&text) else { continue };
            let created = file
                .split('-')
                .next()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            out.push(BackupInfo {
                file,
                title: doc.title,
                path: format!("{}\\{}", doc.hive, doc.path),
                created,
            });
        }
    }
    out.sort_by(|a, b| b.created.cmp(&a.created));
    out
}

pub fn restore_backup(file: &str) -> Result<(), String> {
    let path = backup_dir().join(file);
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let doc: BackupDoc = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let (parent, _) = doc.path.rsplit_once('\\').unwrap_or(("", ""));
    let parent_key = hive_key(&doc.hive)
        .open_subkey_with_flags(format!("{CLASSES}\\{parent}"), write_flags())
        .map_err(|e| format!("打开父项失败（HKLM 需要管理员权限）：{e}"))?;
    let leaf = doc.path.rsplit_once('\\').map(|(_, l)| l).unwrap_or(&doc.path);
    let (child, _) = parent_key
        .create_subkey_with_flags(leaf, KEY_ALL_ACCESS)
        .map_err(|e| format!("重建注册表项失败：{e}"))?;
    restore(&child, &doc.node)?;
    let _ = std::fs::remove_file(path);
    Ok(())
}

#[derive(Deserialize)]
pub struct NewEntry {
    pub hive: String,
    pub scope: String,
    pub name: String,
    pub title: String,
    pub command: String,
    pub icon: String,
}

pub fn create_entry(n: &NewEntry) -> Result<(), String> {
    let base = SCOPES
        .iter()
        .find(|(id, _)| *id == n.scope)
        .map(|(_, b)| *b)
        .ok_or_else(|| "未知的菜单范围".to_string())?;
    let name = n.name.trim();
    if name.is_empty() {
        return Err("菜单项标识不能为空".into());
    }
    if n.command.trim().is_empty() {
        return Err("命令不能为空".into());
    }
    let rel = format!("{base}\\shell\\{name}");
    let (key, _) = hive_key(&n.hive)
        .create_subkey_with_flags(format!("{CLASSES}\\{rel}"), KEY_ALL_ACCESS)
        .map_err(|e| format!("创建注册表项失败（HKLM 需要管理员权限）：{e}"))?;
    key.set_value("", &n.title)
        .map_err(|e| e.to_string())?;
    if !n.icon.trim().is_empty() {
        key.set_value("Icon", &n.icon).map_err(|e| e.to_string())?;
    }
    let (cmd_key, _) = key
        .create_subkey_with_flags("command", KEY_ALL_ACCESS)
        .map_err(|e| e.to_string())?;
    cmd_key.set_value("", &n.command).map_err(|e| e.to_string())?;
    Ok(())
}

/* ---------- 图标 ---------- */

pub fn set_icon(t: &Target, icon: &str) -> Result<(), String> {
    let key = hive_key(&t.hive)
        .open_subkey_with_flags(format!("{CLASSES}\\{}", t.path), write_flags())
        .map_err(|e| format!("打开注册表项失败（HKLM 需要管理员权限）：{e}"))?;
    if icon.trim().is_empty() {
        match key.delete_value("Icon") {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        key.set_value("Icon", &icon.trim())
            .map_err(|e| format!("写入图标失败：{e}"))
    }
}

pub fn load_icons(keys: &[String]) -> std::collections::HashMap<String, String> {
    crate::icons::load(keys)
}

/* ---------- 批量操作 ---------- */

fn to_target(e: &Entry) -> Target {
    Target {
        hive: e.hive.clone(),
        path: e.path.clone(),
        kind: e.kind.clone(),
        name: e.name.clone(),
        clsid: e.clsid.clone(),
    }
}

pub fn set_many_enabled(targets: &[Target], enabled: bool) -> Vec<String> {
    targets
        .iter()
        .filter_map(|t| set_enabled(t, enabled).err().map(|err| format!("{} {}", t.name, err)))
        .collect()
}

pub fn delete_many(targets: &[Target]) -> Vec<String> {
    targets
        .iter()
        .filter_map(|t| delete_entry(t).err().map(|err| format!("{} {}", t.name, err)))
        .collect()
}

/// 删除所有失效项，返回（成功数, 错误列表）
pub fn cleanup_invalid() -> (usize, Vec<String>) {
    let targets: Vec<Target> = list_entries()
        .iter()
        .filter(|e| !e.valid && e.writable)
        .map(to_target)
        .collect();
    let total = targets.len();
    let errors = delete_many(&targets);
    (total - errors.len(), errors)
}

/* ---------- Windows 11 classic context menu ---------- */

pub fn win11_classic() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(WIN11_CLSID, read_flags())
        .is_ok()
}

pub fn set_win11_classic(enabled: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if enabled {
        let (key, _) = hkcu
            .create_subkey_with_flags(format!("{WIN11_CLSID}\\InprocServer32"), KEY_ALL_ACCESS)
            .map_err(|e| e.to_string())?;
        key.set_value("", &"").map_err(|e| e.to_string())?;
    } else {
        match hkcu.delete_subkey_all(WIN11_CLSID) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

/* ---------- elevation ---------- */

pub fn relaunch_as_admin() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy().replace('\'', "''");
    let script = format!(
        "Start-Process -FilePath '{}' -Verb RunAs",
        exe
    );
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .spawn()
        .map_err(|e| e.to_string())?;

    // 发布版：提权实例接管后退出本进程。
    // dev 模式：不能退出——`tauri dev` 会连同 vite dev server 一起结束，
    // 提权后的实例就再也拉不到 devUrl，只剩白屏 / 拒绝连接。
    if cfg!(debug_assertions) {
        return Ok(());
    }
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAME: &str = "MenuForgeSelfTest";
    const REL: &str = "*\\shell\\MenuForgeSelfTest";

    fn cleanup() {
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(format!("{CLASSES}\\{REL}"));
        if let Ok(rd) = std::fs::read_dir(backup_dir()) {
            for item in rd.flatten() {
                if item.file_name().to_string_lossy().contains(NAME) {
                    let _ = std::fs::remove_file(item.path());
                }
            }
        }
    }

    fn find() -> Option<Entry> {
        list_entries()
            .into_iter()
            .find(|e| e.hive == "HKCU" && e.path == REL)
    }

    #[test]
    fn create_toggle_delete_restore() {
        cleanup();

        create_entry(&NewEntry {
            hive: "HKCU".into(),
            scope: "file".into(),
            name: NAME.into(),
            title: "Self Test 项".into(),
            command: "cmd.exe /c echo hi".into(),
            icon: "shell32.dll,3".into(),
        })
        .expect("create");

        let e = find().expect("entry listed after create");
        assert_eq!(e.title, "Self Test 项");
        assert_eq!(e.command, "cmd.exe /c echo hi");
        assert!(e.enabled, "新建项默认启用");

        let target = Target {
            hive: e.hive.clone(),
            path: e.path.clone(),
            kind: e.kind.clone(),
            name: e.name.clone(),
            clsid: e.clsid.clone(),
        };

        set_enabled(&target, false).expect("disable");
        assert!(!find().expect("still listed").enabled, "禁用后状态应为 false");

        set_enabled(&target, true).expect("enable");
        assert!(find().expect("still listed").enabled, "重新启用后状态应为 true");

        delete_entry(&target).expect("delete");
        assert!(find().is_none(), "删除后不应再列出");

        let backup = list_backups()
            .into_iter()
            .find(|b| b.title == NAME)
            .expect("删除时自动生成备份");
        restore_backup(&backup.file).expect("restore");
        assert!(find().is_some(), "恢复后应重新出现");
        assert!(
            list_backups().into_iter().all(|b| b.title != NAME),
            "恢复后备份文件应被清理"
        );

        cleanup();
    }

    #[test]
    fn listing_is_non_empty_and_titles_resolved() {
        let all = list_entries();
        assert!(all.len() > 10, "至少应枚举出 10 个系统菜单项");
        assert!(
            all.iter().any(|e| !e.title.starts_with('@') && !e.title.starts_with('{')),
            "标题应完成间接字符串解析"
        );
    }
}
