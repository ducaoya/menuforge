use winreg::enums::*;
use winreg::RegKey;

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode == "key" {
        let path = std::env::args().nth(2).unwrap_or_default();
        let key = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags(&path, KEY_READ | KEY_WOW64_64KEY);
        match key {
            Ok(k) => {
                for v in k.enum_values().flatten() {
                    println!("VALUE {:<28} {:?} {:?}", v.0, v.1.vtype, String::from_utf16_lossy(&v.1.bytes.chunks(2).map(|c| u16::from_le_bytes([c[0], *c.get(1).unwrap_or(&0)])).collect::<Vec<_>>()));
                }
                for s in k.enum_keys().flatten() {
                    println!("SUBKEY {}", s);
                }
            }
            Err(e) => println!("ERR {e}"),
        }
        return;
    }

    let all = menuforge_lib::registry::list_entries();
    if mode == "invalid" {
        for e in all.iter().filter(|e| !e.valid) {
            println!("{:<4} {:<12} {:<30} {:<28} {}", e.hive, e.scope, &e.name[..e.name.len().min(30)], e.title.chars().take(26).collect::<String>(), e.invalid_reason);
        }
    } else if mode == "icons" {
        let keys: Vec<String> = all.iter().filter(|e| !e.icon_key.is_empty()).map(|e| e.icon_key.clone()).collect();
        let map = menuforge_lib::registry::load_icons(&keys);
        for k in &keys { if !map.contains_key(k) { println!("MISS {}", k); } }
        println!("resolved {}/{}", map.len(), keys.len());
    } else {
        let filter = mode.to_lowercase();
        for e in all.iter().filter(|e| filter.is_empty() || e.title.to_lowercase().contains(&filter) || e.name.to_lowercase().contains(&filter)) {
            println!("{:<4} {:<12} {:<26} enabled={:<5} valid={:<5} icon={:<40} {}", e.hive, e.scope, &e.name[..e.name.len().min(26)], e.enabled, e.valid, if e.icon_key.is_empty() { "-".into() } else { e.icon_key.clone() }, if e.valid { String::new() } else { e.invalid_reason.clone() });
        }
    }
}
