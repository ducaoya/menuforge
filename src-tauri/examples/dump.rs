fn main() {
    let filter = std::env::args().nth(1).unwrap_or_default().to_lowercase();
    for e in menuforge_lib::registry::list_entries() {
        if filter.is_empty() || e.title.to_lowercase().contains(&filter) || e.name.to_lowercase().contains(&filter) {
            println!("{:<4} {:<18} {:<8} enabled={:<5} kind={:<8} path={} cmd={}", e.hive, e.scope, e.name, e.enabled, e.kind, e.path, e.command);
        }
    }
}
