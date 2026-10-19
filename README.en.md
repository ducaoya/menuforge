<div align="center">

# MenuForge

**Tame the Windows right-click menu.**

[简体中文](README.md) · [English](README.en.md)

</div>

<div align="center">

[![Release](https://img.shields.io/github/v/release/ducaoya/menuforge?color=0a84ff&label=version)](https://github.com/ducaoya/menuforge/releases/latest)
[![Build](https://github.com/ducaoya/menuforge/actions/workflows/release.yml/badge.svg)](https://github.com/ducaoya/menuforge/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-30d158.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2011-0078d4)

</div>

---

## Why

Install a handful of apps and the context menu turns into a graveyard: leftovers from uninstalled software, dead commands, duplicated "Open with" entries.

MenuForge lays everything out in one screen so you can see it, switch it off, delete it — and undo that whenever you want.

## Features

| | Feature | What it does |
|---|---|---|
| 🗂 | **Everything in one view** | Files, folders, folder background, drives, desktop, folder shell, all filesystem objects — 7 locations listed together |
| 🎨 | **Real icons** | Icons are extracted from the actual programs, not guessed; click any entry to pick a different one |
| 🧊 | **Visual icon picker** | Browse a built-in system icon library, or pull every icon out of any `exe / dll / ico` |
| 🔘 | **One-switch toggle** | Disable instead of delete — fully reversible |
| ☑️ | **Bulk actions** | Multi-select, then enable / disable / delete in one go |
| 🧹 | **Dead-entry cleanup** | Detects menu items whose target no longer exists and cleans them up at once |
| 🛟 | **Delete means backup** | Every removal is backed up first; restore or purge it from the Backups tab |
| ✨ | **Full Win11 menu** | One toggle brings back the classic Windows 10 style context menu |
| 🔒 | **Scoped permissions** | Runs read-only for system-wide entries until you explicitly elevate |
| 🪟 | **Native and tiny** | ~1.2 MB installer, no Electron, no background service |

## Interface

Liquid-glass surfaces, a frameless window, grouped lists and iOS-style controls. Hover, selection and toggles all give clear feedback — no animation for the sake of animation.

## Download

Grab the latest `MenuForge_x.y.z_x64-setup.exe` from [Releases](https://github.com/ducaoya/menuforge/releases/latest) and run it.

> Windows 11 recommended (works on Windows 10, but icons and styling follow Win11).

## Safety

- Changes are written to the exact registry location — **disable with a reversible flag, delete with a backup**
- Backups live in `%APPDATA%\MenuForge\backups` as readable JSON files
- Editing system-wide (all users) entries requires administrator rights; the app never elevates silently

## License

[MIT](./LICENSE) © 2026 ducaoya &lt;ducaoya@gmail.com&gt;

<div align="center">

[中文版 →](README.md)

</div>
