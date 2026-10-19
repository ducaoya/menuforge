# MenuForge · Windows 右键菜单管理器

现代化界面的右键菜单管理器，基于 **Tauri 2 + React 19 + Rust**，安装包约 **1.2 MB**，可执行文件约 **3.3 MB**（无需安装运行时，Win11 自带 WebView2）。

## 功能

- 列出当前系统所有**经典右键菜单项**（静态菜单项 + Shell 扩展处理器），共 7 个范围：文件、文件夹、文件夹空白处、驱动器、桌面背景、文件夹目录、全部对象
- 一键**启用 / 禁用**（静态项用 `LegacyDisable`，Shell 扩展用 Blocked 列表，均为可逆操作，不删除数据）
- 一键**删除**，删除前自动**全量备份**到 `%APPDATA%\MenuForge\backups`，可在「备份」页**恢复**
- **新建自定义菜单项**：显示名、命令、图标、写入位置（HKCU/HKLM）
- 一键切换 **Win11 完整右键菜单**（Win10 风格）
- 菜单项名称自动解析 `@shell32.dll,-8506` 形式的间接字符串与 CLSID 显示名
- 非管理员启动时只读显示系统级（HKLM）项，并提示「以管理员身份重启」

## 体积

| 产物 | 大小 |
| --- | --- |
| `menuforge.exe` | 3.35 MB |
| `MenuForge_0.1.0_x64-setup.exe`（NSIS 安装包） | 1.18 MB |
| 前端资源（内嵌进 exe） | JS 234 KB / CSS 8 KB |

体积优化：`opt-level = "s"` + `lto = true` + `codegen-units = 1` + `panic = "abort"` + `strip = true`，前端不引 UI 库，手写 CSS。

## 开发

```bash
pnpm install
pnpm tauri dev      # 开发模式（热更新）
pnpm tauri build    # 打包，产物在 src-tauri/target/release/bundle/nsis/
cargo test --manifest-path src-tauri/Cargo.toml   # 注册表读写回归测试
```

## 实现要点

- 注册表访问全部走 64 位视图（`KEY_WOW64_64KEY`）
- 禁用静态菜单项：写入空的 `LegacyDisable` 值；启用即删除该值
- 禁用 Shell 扩展：写入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked`（CLSID 名 = 空串）
- 删除备份为 JSON 快照（保留 `REG_SZ` / `REG_EXPAND_SZ` / `REG_MULTI_SZ` / `REG_BINARY` / `REG_DWORD` / `REG_QWORD` 原始字节与类型），恢复时逐值重建
- HKLM 写入需要管理员：应用不强制提权，按需「以管理员身份重启」

## 目录

```
src/                 前端（React + 手写 CSS）
  api.ts             invoke 封装与类型
  App.tsx            主界面：列表 / 开关 / 新建 / 备份
src-tauri/src/
  registry.rs        注册表枚举、快照备份、启用禁用、新建删除、Win11 经典菜单
  lib.rs             Tauri 命令注册
scripts/gen-icon.mjs 无依赖生成 1024px 应用图标源图
```

## 已知限制

- Win11 的**新式**（一级）右键菜单由已签名的打包 Shell 扩展提供，本工具管理的是经典菜单 + 「切回 Win10 风格」开关
- 静态菜单项无法自定义排序（Explorer 按名称排序，仅支持 `Position` 置顶/置底）
- 部分 Shell 扩展本身不提供显示名时，回退展示其注册键名

## 许可

MIT
