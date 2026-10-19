<div align="center">

# MenuForge

**把 Windows 右键菜单收拾干净。**

[简体中文](README.md) · [English](README.en.md)

</div>

<div align="center">

[![Release](https://img.shields.io/github/v/release/ducaoya/menuforge?color=0a84ff&label=version)](https://github.com/ducaoya/menuforge/releases/latest)
[![Build](https://github.com/ducaoya/menuforge/actions/workflows/release.yml/badge.svg)](https://github.com/ducaoya/menuforge/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-30d158.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2011-0078d4)

</div>

---

## 它解决什么

装完一堆软件后，右键菜单会变成一张挤满废弃项的长清单：卸载残留、失效的命令、重复的“打开方式”。

MenuForge 把这些东西一次性摊开，让你看清楚、关掉、删掉，并且随时能恢复。

## 主要能力

| | 能力 | 说明 |
|---|---|---|
| 🗂 | **一屏看全** | 文件、文件夹、文件夹空白处、驱动器、桌面背景、文件夹目录、全部对象 —— 7 类位置全部列出 |
| 🎨 | **真实图标** | 从程序本身提取图标，不是猜的；也支持点击任意一项换成你喜欢的图标 |
| 🧊 | **图标可视化挑选** | 内置系统图标库，或直接从任意 `exe / dll / ico` 里翻出所有图标挑一个 |
| 🔘 | **一键启停** | 关掉而不是删除，随时能开回来；改动可逆 |
| ☑️ | **批量处理** | 多选后统一启用、禁用、删除 |
| 🧹 | **失效项清理** | 自动识别“程序已经不在了”的菜单项，一键打包清理 |
| 🛟 | **删除即备份** | 每次删除前自动完整备份，可在「备份」页一键还原或彻底删除 |
| ✨ | **Win11 完整菜单** | 一个开关切回 Windows 10 风格的完整右键菜单 |
| 🔒 | **权限分级** | 普通启动只读系统级条目，需要时再提权，不乱写注册表 |
| 🪟 | **原生轻量** | 安装包约 1.2 MB，无 Electron，不常驻后台 |

## 界面

液态玻璃质感、无边框窗口、分组列表与 iOS 风格控件；选中、悬停、开关都有明确反馈，不做无意义的动效。

## 下载

前往 [Releases](https://github.com/ducaoya/menuforge/releases/latest) 下载最新的 `MenuForge_x.y.z_x64-setup.exe`，双击安装即可。

> 需要 Windows 11（Windows 10 也可用，但系统图标与菜单样式以 Win11 为准）。

## 安全

- 所有改动都写在注册表对应位置，**禁用用可逆标记、删除先备份**
- 备份保存在 `%APPDATA%\MenuForge\backups`，每份都是可读的 JSON
- 修改系统级（所有用户）条目需要管理员权限，程序不会静默提权

## 许可

[MIT](./LICENSE) © 2026 ducaoya &lt;ducaoya@gmail.com&gt;

<div align="center">

[English version →](README.en.md)

</div>
