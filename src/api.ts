import { invoke } from "@tauri-apps/api/core";

export type Entry = {
  hive: string;
  path: string;
  kind: string;
  name: string;
  scope: string;
  title: string;
  command: string;
  icon: string;
  enabled: boolean;
  clsid: string;
  shift_only: boolean;
  needs_admin: boolean;
  submenu: boolean;
  writable: boolean;
};

export type Target = {
  hive: string;
  path: string;
  kind: string;
  name: string;
  clsid: string;
};

export type NewEntry = {
  hive: string;
  scope: string;
  name: string;
  title: string;
  command: string;
  icon: string;
};

export type BackupInfo = {
  file: string;
  title: string;
  path: string;
  created: number;
};

export const api = {
  list: () => invoke<Entry[]>("list_entries"),
  toggle: (target: Target, enabled: boolean) =>
    invoke<void>("set_entry_enabled", { target, enabled }),
  remove: (target: Target) => invoke<void>("delete_entry", { target }),
  create: (entry: NewEntry) => invoke<void>("create_entry", { entry }),
  backups: () => invoke<BackupInfo[]>("list_backups"),
  restore: (file: string) => invoke<void>("restore_backup", { file }),
  win11Classic: () => invoke<boolean>("win11_classic"),
  setWin11Classic: (enabled: boolean) =>
    invoke<void>("set_win11_classic", { enabled }),
  isAdmin: () => invoke<boolean>("is_admin"),
  relaunch: () => invoke<void>("relaunch_as_admin"),
};

export const SCOPES: { id: string; label: string; hint: string }[] = [
  { id: "file", label: "文件", hint: "任意文件上右键" },
  { id: "directory", label: "文件夹", hint: "文件夹上右键" },
  { id: "background", label: "文件夹空白处", hint: "文件夹内空白处右键" },
  { id: "drive", label: "驱动器", hint: "磁盘分区上右键" },
  { id: "desktop", label: "桌面背景", hint: "桌面空白处右键" },
  { id: "folder", label: "文件夹目录", hint: "Folder 类对象" },
  { id: "all", label: "全部对象", hint: "AllFilesystemObjects" },
];
