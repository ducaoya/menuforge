# MenuForge · Windows 右键菜单管理器

液态玻璃风格界面的右键菜单管理器，基于 **Tauri 2 + React 19 + Rust**：安装包约 **1.23 MB**，可执行文件约 **3.45 MB**（Win11 自带 WebView2，无需另装运行时）。

## 功能

- 列出系统所有**经典右键菜单项**（静态菜单项 + Shell 扩展处理器），7 个范围：文件、文件夹、文件夹空白处、驱动器、桌面背景、文件夹目录、全部对象
- **真实图标**：从 exe / dll 提取（`ExtractIconEx` → PNG），带内存缓存；静态项可**点击图标自定义**（写入 `Icon` 值，如 `C:\App\app.exe,3`）
- **多选批量操作**：复选 / Shift 连选 / `Ctrl+A` 全选 / `Delete` 删除，批量启用、禁用、删除
- **一键启用 / 禁用**：静态项写 `LegacyDisable`，Shell 扩展写 Blocked 列表，均为可逆操作
- **一键删除**：删除前自动全量备份到 `%APPDATA%\MenuForge\backups`，「备份」页可恢复
- **失效项检测与清理**：命令指向的程序不存在、缺少 `command`、CLSID 未注册 → 标记「失效」并支持一键清理（先备份）
- **新建自定义菜单项**：显示名、命令、图标、写入位置（HKCU/HKLM）
- 一键切换 **Win11 完整右键菜单**（Win10 风格）
- 名称自动解析 `@shell32.dll,-8506` 形式的间接字符串与 CLSID 显示名
- 非管理员启动时只读显示系统级（HKLM）项，并提示「以管理员身份重启」

## 界面

- 无边框窗口 + DWM Acrylic 背景（`windowEffects: acrylic`），CSS 手写液态玻璃层次：多层半透明渐变、内高光描边、iOS 风格开关与分段控件、弹性缓动 `cubic-bezier(.32,.72,0,1)`
- 自绘标题栏（拖拽 / 最小化 / 最大化 / 关闭），`data-tauri-drag-region` + `core:window:*` 权限

## 体积

| 产物 | 大小 |
| --- | --- |
| `menuforge.exe` | 3.45 MB |
| `MenuForge_0.1.0_x64-setup.exe`（NSIS） | 1.23 MB |
| 前端资源（内嵌进 exe） | JS 256 KB / CSS 14 KB |

体积优化：`opt-level = "s"` + `lto` + `codegen-units = 1` + `panic = "abort"` + `strip`；前端不引 UI 库，手写 CSS；图标提取用 `windows-sys` 直接调 GDI，不引重型图像库（只加了 `png`、`base64`）。

## 开发

```bash
pnpm install
pnpm tauri dev      # 开发模式（热更新）
pnpm tauri build    # 打包，产物在 src-tauri/target/release/bundle/nsis/
cargo test --manifest-path src-tauri/Cargo.toml   # 注册表读写回归测试
cargo run --manifest-path src-tauri/Cargo.toml --example dump invalid   # 列出失效项
cargo run --manifest-path src-tauri/Cargo.toml --example dump icons     # 图标解析情况
```

需要调试 HKLM 写入时：用管理员终端跑 `pnpm tauri dev`，或先 `pnpm dev` 再以管理员身份启动 `src-tauri\target\debug\menuforge.exe`。

## 实现要点

- 注册表访问全部走 64 位视图（`KEY_WOW64_64KEY`）
- 图标：`ExtractIconExW` → `GetIconInfo`/`GetDIBits` 取 BGRA 位图（老图标用掩码补 alpha）→ `png` 编码 → base64 data URL，进程内按 `path|index` 缓存；裸文件名会去 System32 / SysWOW64 / PATH 找
- 禁用静态菜单项：写入空的 `LegacyDisable`；启用即删除该值
- 禁用 Shell 扩展：写入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked`（值名 = CLSID，数据 = 空串）
- 失效判定排除 `DelegateExecute` / `ExplorerCommandHandler` / `{CLSID}` 子键 / `DropTarget` / `ProgrammaticAccessOnly` 等系统内置机制，避免误报
- 删除备份为 JSON 快照（保留 `REG_SZ` / `REG_EXPAND_SZ` / `REG_MULTI_SZ` / `REG_BINARY` / `REG_DWORD` / `REG_QWORD` 原始字节与类型），恢复时逐值重建
- HKLM 写入需要管理员：应用不强制提权，按需「以管理员身份重启」

## 目录

```
src/                 前端（React + 手写 CSS）
  api.ts             invoke 封装与类型
  App.tsx            主界面：列表 / 多选 / 开关 / 新建 / 图标编辑 / 备份
  styles.css         液态玻璃样式
src-tauri/src/
  registry.rs        注册表枚举、快照备份、批量操作、失效检测、Win11 经典菜单
  icons.rs           图标提取与 PNG 编码、路径解析、缓存
  lib.rs             Tauri 命令注册
src-tauri/examples/dump.rs   命令行查看菜单项 / 失效项 / 图标解析
scripts/gen-icon.mjs         无依赖生成 1024px 应用图标源图
```

## 已知限制

- Win11 的**新式**（一级）右键菜单由已签名的打包 Shell 扩展提供，本工具管理的是经典菜单 + 「切回 Win10 风格」开关
- 静态菜单项无法自定义排序（Explorer 按名称排序，仅支持 `Position` 置顶/置底）
- Shell 扩展的图标由它自己的 DLL 决定，不能在界面里改
- 部分 DLL 不含图标资源，此时回退显示名称首字母色块

## 许可

MIT
