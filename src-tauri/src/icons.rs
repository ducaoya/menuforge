//! 从 exe / dll 中提取图标，转成 PNG data URL（带内存缓存）。
use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use serde::Serialize;
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BI_RGB,
    DIB_RGB_COLORS,
};
use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows_sys::Win32::UI::Shell::ExtractIconExW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetIconInfo, HICON, ICONINFO,
};

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

fn expand_env(input: &str) -> String {
    let src = wide(input);
    let mut buf = vec![0u16; 1024];
    let n = unsafe {
        ExpandEnvironmentStringsW(src.as_ptr(), buf.as_mut_ptr(), buf.len() as u32)
    };
    if n == 0 || n as usize > buf.len() {
        return input.to_string();
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(n as usize);
    String::from_utf16_lossy(&buf[..len])
}

/// `"C:\App\a.exe",-3` / `shell32.dll,12` / `C:\App\a.exe` → (路径, 索引)
pub fn parse_spec(spec: &str) -> Option<(String, i32)> {
    let raw = spec.trim().trim_matches('"');
    if raw.is_empty() {
        return None;
    }
    let (path_part, index) = match raw.rsplit_once(',') {
        Some((p, i)) => match i.trim().parse::<i32>() {
            Ok(n) => (p, n),
            Err(_) => (raw, 0),
        },
        None => (raw, 0),
    };
    let path = expand_env(path_part.trim().trim_matches('"'));
    if path.is_empty() {
        return None;
    }
    Some((path, index))
}

/// 取命令行的首个 token（已展开环境变量，不检查是否存在）
pub fn first_token(command: &str) -> String {
    let cmd = command.trim();
    if cmd.is_empty() {
        return String::new();
    }
    let first = if let Some(rest) = cmd.strip_prefix('"') {
        rest.split('"').next().unwrap_or("")
    } else {
        cmd.split_whitespace().next().unwrap_or("")
    };
    expand_env(first)
}

/// 把裸文件名解析成真实路径（system32 / SysWOW64 / PATH / 补 .exe）
pub fn resolve_file(name: &str) -> Option<String> {
    if name.is_empty() {
        return None;
    }
    if Path::new(name).is_file() {
        return Some(name.to_string());
    }
    if name.contains('\\') || name.contains('/') || name.contains(':') {
        return None;
    }
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let mut dirs = vec![
        format!("{sysroot}\\System32"),
        format!("{sysroot}\\SysWOW64"),
    ];
    if let Ok(path_var) = std::env::var("PATH") {
        dirs.extend(
            path_var
                .split(';')
                .filter(|d| !d.trim().is_empty())
                .map(|d| d.trim().to_string()),
        );
    }
    for dir in dirs {
        for candidate in [format!("{dir}\\{name}"), format!("{dir}\\{name}.exe")] {
            if Path::new(&candidate).is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 从命令行取出可执行文件路径（支持引号、环境变量、system32 兜底）
pub fn command_exe(command: &str) -> Option<String> {
    resolve_file(&first_token(command))
}

fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn key(path: &str, index: i32) -> String {
    format!("{path}|{index}")
}

/// 读取并缓存某个图标的 data URL
pub fn data_url(k: &str) -> Option<String> {
    if let Ok(map) = cache().lock() {
        if let Some(hit) = map.get(k) {
            return hit.clone();
        }
    }
    let (path, index) = k.rsplit_once('|')?;
    let index = index.parse::<i32>().unwrap_or(0);
    let value = match resolve_file(path) {
        Some(real) => extract_png(&real, index)
            .or_else(|| if index < 0 { extract_png(&real, 0) } else { None })
            .or_else(|| extract_png(&real, 1)),
        None => None,
    };
    if let Ok(mut map) = cache().lock() {
        map.insert(k.to_string(), value.clone());
    }
    value
}

pub fn load(keys: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for k in keys {
        if let Some(v) = data_url(k) {
            out.insert(k.clone(), v);
        }
    }
    out
}

fn extract_png(path: &str, index: i32) -> Option<String> {
    let (w, h, rgba) = extract_rgba(path, index)?;
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&rgba).ok()?;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Some(format!("data:image/png;base64,{b64}"))
}

fn extract_rgba(path: &str, index: i32) -> Option<(u32, u32, Vec<u8>)> {
    let wpath = wide(path);
    let mut large: HICON = std::ptr::null_mut();
    let mut small: HICON = std::ptr::null_mut();
    let count = unsafe { ExtractIconExW(wpath.as_ptr(), index, &mut large, &mut small, 1) };
    if count == 0 {
        return None;
    }
    let hicon = if !large.is_null() { large } else { small };
    if hicon.is_null() {
        return None;
    }
    let out = hicon_to_rgba(hicon);
    unsafe {
        if !large.is_null() {
            DestroyIcon(large);
        }
        if !small.is_null() {
            DestroyIcon(small);
        }
    }
    out
}

fn hicon_to_rgba(hicon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(hicon, &mut info) == 0 {
            return None;
        }
        let cleanup = |info: &ICONINFO| {
            if !info.hbmColor.is_null() {
                DeleteObject(info.hbmColor as _);
            }
            if !info.hbmMask.is_null() {
                DeleteObject(info.hbmMask as _);
            }
        };

        let mut bmp: BITMAP = std::mem::zeroed();
        let got = GetObjectW(
            info.hbmColor as *mut _, 
            std::mem::size_of::<BITMAP>() as i32,
            &mut bmp as *mut _ as *mut _,
        );
        if got == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
            cleanup(&info);
            return None;
        }
        let w = bmp.bmWidth as u32;
        let h = bmp.bmHeight as u32;

        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader.biSize = std::mem::size_of_val(&bi.bmiHeader) as u32;
        bi.bmiHeader.biWidth = w as i32;
        bi.bmiHeader.biHeight = -(h as i32);
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB;

        let dc = CreateCompatibleDC(std::ptr::null_mut());
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let lines = GetDIBits(
            dc,
            info.hbmColor,
            0,
            h,
            buf.as_mut_ptr() as _,
            &mut bi,
            DIB_RGB_COLORS,
        );
        DeleteDC(dc);
        if lines == 0 {
            cleanup(&info);
            return None;
        }

        // BGRA -> RGBA
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
        }

        // 老式图标没有 alpha 通道，用掩码补
        if buf.chunks_exact(4).all(|p| p[3] == 0) {
            if let Some(mask) = read_mask(&info, w, h) {
                for (i, px) in buf.chunks_exact_mut(4).enumerate() {
                    px[3] = if mask[i] { 255 } else { 0 };
                }
            } else {
                for px in buf.chunks_exact_mut(4) {
                    px[3] = 255;
                }
            }
        }

        cleanup(&info);
        Some((w, h, buf))
    }
}

unsafe fn read_mask(info: &ICONINFO, w: u32, h: u32) -> Option<Vec<bool>> {
    if info.hbmMask.is_null() {
        return None;
    }
    let mut bi: BITMAPINFO = std::mem::zeroed();
    bi.bmiHeader.biSize = std::mem::size_of_val(&bi.bmiHeader) as u32;
    bi.bmiHeader.biWidth = w as i32;
    bi.bmiHeader.biHeight = -(h as i32);
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 1;
    bi.bmiHeader.biCompression = BI_RGB;

    let stride = ((w + 31) / 32 * 4) as usize;
    let mut raw = vec![0u8; stride * h as usize];
    let dc = CreateCompatibleDC(std::ptr::null_mut());
    let lines = GetDIBits(
        dc,
        info.hbmMask,
        0,
        h,
        raw.as_mut_ptr() as _,
        &mut bi,
        DIB_RGB_COLORS,
    );
    DeleteDC(dc);
    if lines == 0 {
        return None;
    }

    let mut out = Vec::with_capacity((w * h) as usize);
    for y in 0..h as usize {
        for x in 0..w as usize {
            let byte = raw[y * stride + x / 8];
            let bit = (byte >> (7 - (x % 8))) & 1;
            out.push(bit == 0);
        }
    }
    Some(out)
}


/* ---------- 图标选择器支持 ---------- */

#[derive(Serialize)]
pub struct IconItem {
    pub index: i32,
    pub data: String,
}

/// 列出某个 exe/dll/ico 里前 `limit` 个图标（带 PNG data URL）
pub fn icons_in_file(path: &str, limit: usize) -> Vec<IconItem> {
    let Some(real) = resolve_file(path) else {
        return Vec::new();
    };
    let wpath = wide(&real);
    let count = unsafe {
        ExtractIconExW(
            wpath.as_ptr(),
            -1,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    } as usize;
    let count = count.min(limit);
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        if let Some(data) = data_url(&key(&real, i as i32)) {
            out.push(IconItem {
                index: i as i32,
                data,
            });
        }
    }
    out
}

/// 弹出系统文件选择框，只筛可能的图标/程序文件
pub fn pick_file(owner: *mut core::ffi::c_void) -> Option<String> {
    use windows_sys::Win32::UI::Controls::Dialogs::{
        GetOpenFileNameW, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    let filter: Vec<u16> = "图标 / 程序 (*.exe;*.dll;*.ico;*.cpl;*.ocx;*.mun;*.icl) *.exe;*.dll;*.ico;*.cpl;*.ocx;*.mun;*.icl 所有文件 (*.*) *.*  "
        .encode_utf16()
        .collect();
    let title: Vec<u16> = "选择图标文件 ".encode_utf16().collect();
    let mut buf = vec![0u16; 1024];

    let mut ofn: OPENFILENAMEW = unsafe { std::mem::zeroed() };
    ofn.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = filter.as_ptr();
    ofn.lpstrFile = buf.as_mut_ptr();
    ofn.nMaxFile = buf.len() as u32;
    ofn.lpstrTitle = title.as_ptr();
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY;

    let ok = unsafe { GetOpenFileNameW(&mut ofn) };
    if ok == 0 {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len]))
}
