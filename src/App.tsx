import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  api,
  type BackupInfo,
  type Entry,
  type NewEntry,
  SCOPES,
  type Target,
} from "./api";
import "./styles.css";

type Tab = "menu" | "backups";
type Toast = { kind: "ok" | "err"; text: string } | null;

const win = getCurrentWindow();
const scopeLabel = (id: string) => SCOPES.find((s) => s.id === id)?.label ?? id;
const keyOf = (e: Entry) => `${e.hive}|${e.path}|${e.kind}`;
const toTarget = (e: Entry): Target => ({
  hive: e.hive,
  path: e.path,
  kind: e.kind,
  name: e.name,
  clsid: e.clsid,
});

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<string>("*");
  const [query, setQuery] = useState("");
  const [admin, setAdmin] = useState(false);
  const [classic, setClassic] = useState(false);
  const [tab, setTab] = useState<Tab>("menu");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Target[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingIcon, setEditingIcon] = useState<Entry | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [list, isAdmin, classicMenu] = await Promise.all([
      api.list(),
      api.isAdmin(),
      api.win11Classic(),
    ]);
    setEntries(list);
    setAdmin(isAdmin);
    setClassic(classicMenu);
    setLoading(false);
    setSelected((prev) => {
      const alive = new Set(list.map(keyOf));
      const next = new Set([...prev].filter((k) => alive.has(k)));
      return next.size === prev.size ? prev : next;
    });
    const keys = [...new Set(list.map((e) => e.icon_key).filter(Boolean))];
    if (keys.length) {
      const map = await api.icons(keys);
      setIcons((prev) => ({ ...prev, ...map }));
    }
  }, []);

  const loadBackups = useCallback(async () => {
    setBackups(await api.backups());
  }, []);

  useEffect(() => {
    load();
    loadBackups();
  }, [load, loadBackups]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const say = (kind: "ok" | "err", text: string) => setToast({ kind, text });

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) map[e.scope] = (map[e.scope] ?? 0) + 1;
    return map;
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (scope !== "*" && e.scope !== scope) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.command.toLowerCase().includes(q)
      );
    });
  }, [entries, scope, query]);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(keyOf(e))),
    [entries, selected],
  );
  const invalid = useMemo(() => entries.filter((e) => !e.valid), [entries]);

  const clickRow = (index: number, shift: boolean) => {
    const e = visible[index];
    const k = keyOf(e);
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchor !== null) {
        const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
        for (let i = a; i <= b; i++) next.add(keyOf(visible[i]));
      } else if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
    setAnchor(index);
  };

  const toggle = async (e: Entry) => {
    setBusy(true);
    try {
      await api.toggle(toTarget(e), !e.enabled);
      await load();
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(false);
    }
  };

  const setMany = async (enabled: boolean) => {
    setBusy(true);
    try {
      const errors = await api.toggleMany(selectedEntries.map(toTarget), enabled);
      await load();
      setSelected(new Set());
      if (errors.length) say("err", errors[0]);
      else say("ok", `已${enabled ? "启用" : "禁用"} ${selectedEntries.length} 项`);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (targets: Target[]) => {
    setBusy(true);
    try {
      const errors =
        targets.length === 1
          ? await api
              .remove(targets[0])
              .then(() => [] as string[])
              .catch((e) => [String(e)])
          : await api.removeMany(targets);
      setPendingDelete(null);
      setSelected(new Set());
      await Promise.all([load(), loadBackups()]);
      if (errors.length) say("err", errors[0]);
      else say("ok", `已删除 ${targets.length} 项（已备份）`);
    } finally {
      setBusy(false);
    }
  };

  const cleanup = async () => {
    setBusy(true);
    try {
      const [n, errors] = await api.cleanupInvalid();
      await Promise.all([load(), loadBackups()]);
      if (errors.length) say("err", `清理 ${n} 项，失败 ${errors.length} 项：${errors[0]}`);
      else say("ok", `已清理 ${n} 个失效项（可恢复）`);
    } finally {
      setBusy(false);
    }
  };

  const flipClassic = async () => {
    setBusy(true);
    try {
      await api.setWin11Classic(!classic);
      setClassic(!classic);
      say("ok", !classic ? "已启用 Win11 完整右键菜单" : "已恢复 Win11 精简菜单");
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: string) => {
    setBusy(true);
    try {
      await api.restore(file);
      await Promise.all([load(), loadBackups()]);
      say("ok", "已恢复该菜单项");
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveIcon = async (e: Entry, value: string) => {
    setBusy(true);
    try {
      await api.setIcon(toTarget(e), value);
      setEditingIcon(null);
      await load();
      say("ok", value.trim() ? "图标已更新" : "已恢复默认图标");
    } catch (err) {
      say("err", String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      if (tab === "menu" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        setSelected(new Set(visible.map(keyOf)));
      }
    }
    if (event.key === "Escape") setSelected(new Set());
    if (event.key === "Delete" && selected.size > 0) {
      setPendingDelete(selectedEntries.map(toTarget));
    }
  };

  return (
    <div className="app" onKeyDown={onKeyDown} tabIndex={0}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <span className="logo" data-tauri-drag-region />
          <span className="brand-name" data-tauri-drag-region>
            MenuForge
          </span>
          <span className="brand-sub" data-tauri-drag-region>
            右键菜单管理器
          </span>
        </div>
        <div className="window-actions">
          <button className="win-btn" onClick={() => win.minimize()} title="最小化">
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path d="M2 5.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="win-btn"
            onClick={() => {
              win.toggleMaximize().then(() => setMaximized(!maximized));
            }}
            title={maximized ? "还原" : "最大化"}
          >
            <svg width="11" height="11" viewBox="0 0 11 11">
              <rect x="2.2" y="2.2" width="6.6" height="6.6" rx="1.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </button>
          <button className="win-btn close" onClick={() => win.close()} title="关闭">
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path d="M2.6 2.6l5.8 5.8M8.4 2.6L2.6 8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <nav className="nav">
            <button
              className={scope === "*" ? "nav-item active" : "nav-item"}
              onClick={() => setScope("*")}
            >
              <span>全部菜单项</span>
              <em>{entries.length}</em>
            </button>
            {SCOPES.map((s) => (
              <button
                key={s.id}
                className={scope === s.id ? "nav-item active" : "nav-item"}
                onClick={() => setScope(s.id)}
                title={s.hint}
              >
                <span>{s.label}</span>
                <em>{counts[s.id] ?? 0}</em>
              </button>
            ))}
          </nav>

          <div className="side-cards">
            <div className="glass-card">
              <div className="card-title">
                <span>Win11 完整菜单</span>
                <Switch on={classic} onClick={flipClassic} disabled={busy} />
              </div>
              <p>{classic ? "当前为 Win10 风格完整菜单" : "当前为 Win11 精简菜单"}</p>
            </div>

            <div className="glass-card">
              <div className="card-title">
                <span>权限</span>
                <b className={admin ? "pill ok" : "pill warn"}>
                  {admin ? "管理员" : "受限"}
                </b>
              </div>
              {admin ? (
                <p>可修改系统级（HKLM）菜单项</p>
              ) : (
                <button
                  className="mini-btn"
                  onClick={() =>
                    api
                      .relaunch()
                      .then(() => say("ok", "已请求提权，请在 UAC 弹窗确认"))
                      .catch((e) => say("err", String(e)))
                  }
                >
                  以管理员身份重启
                </button>
              )}
            </div>

            <div className="glass-card">
              <div className="card-title">
                <span>失效项</span>
                <b className={invalid.length ? "pill warn" : "pill ok"}>
                  {invalid.length}
                </b>
              </div>
              {invalid.length > 0 ? (
                <button className="mini-btn danger" onClick={cleanup} disabled={busy}>
                  一键清理（先备份）
                </button>
              ) : (
                <p>所有菜单项均可用</p>
              )}
            </div>
          </div>

          <button className="primary-btn" onClick={() => setShowCreate(true)}>
            <span>＋</span> 新建菜单项
          </button>
        </aside>

        <main className="main">
          <div className="toolbar">
            <div className="segmented">
              <button
                className={tab === "menu" ? "seg active" : "seg"}
                onClick={() => setTab("menu")}
              >
                菜单项
              </button>
              <button
                className={tab === "backups" ? "seg active" : "seg"}
                onClick={() => (setTab("backups"), loadBackups())}
              >
                备份{backups.length > 0 && <em>{backups.length}</em>}
              </button>
            </div>

            {tab === "menu" && (
              <>
                <div className="search-wrap">
                  <svg width="14" height="14" viewBox="0 0 14 14" className="search-icon">
                    <circle cx="6.2" cy="6.2" r="4.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
                    <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                  <input
                    className="search"
                    placeholder="搜索名称 / 命令"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="toolbar-actions">
                  <button className="ghost-btn" onClick={() => (load(), loadBackups())} disabled={busy}>
                    刷新
                  </button>
                </div>
              </>
            )}
          </div>

          {tab === "menu" && selected.size > 0 && (
            <div className="batch-bar">
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.size === visible.length && visible.length > 0}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(visible.map(keyOf)) : new Set())
                  }
                />
                已选 {selected.size} 项
              </label>
              <div className="batch-actions">
                <button className="ghost-btn" onClick={() => setMany(true)} disabled={busy}>
                  启用
                </button>
                <button className="ghost-btn" onClick={() => setMany(false)} disabled={busy}>
                  禁用
                </button>
                <button
                  className="ghost-btn danger"
                  onClick={() => setPendingDelete(selectedEntries.map(toTarget))}
                  disabled={busy}
                >
                  删除
                </button>
                <button className="ghost-btn" onClick={() => setSelected(new Set())}>
                  取消
                </button>
              </div>
            </div>
          )}

          {tab === "menu" ? (
            <div className="list" ref={listRef}>
              {loading && <div className="empty">正在读取注册表…</div>}
              {!loading && visible.length === 0 && (
                <div className="empty">没有匹配的菜单项</div>
              )}
              {visible.map((e, i) => {
                const k = keyOf(e);
                const isSel = selected.has(k);
                const locked = !e.writable;
                return (
                  <div
                    className={[
                      "row",
                      e.enabled ? "" : "off",
                      isSel ? "selected" : "",
                      e.valid ? "" : "invalid",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={k}
                    onClick={(ev) => {
                      if ((ev.target as HTMLElement).closest("button,input")) return;
                      clickRow(i, ev.shiftKey);
                    }}
                  >
                    <label className="row-check" onClick={(ev) => ev.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          })
                        }
                      />
                    </label>

                    <button
                      className="icon-tile"
                      title={e.kind === "handler" ? "Shell 扩展的图标由 DLL 提供" : "点击修改图标"}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (e.kind === "handler") {
                          say("err", "Shell 扩展的图标由它自己的 DLL 提供，不能在这里改");
                          return;
                        }
                        setEditingIcon(e);
                      }}
                    >
                      {icons[e.icon_key] ? (
                        <img src={icons[e.icon_key]} alt="" draggable={false} />
                      ) : (
                        <span className="icon-fallback">{e.title.slice(0, 1)}</span>
                      )}
                    </button>

                    <div className="row-main">
                      <div className="row-title-line">
                        <span className="row-title">{e.title}</span>
                        {!e.valid && <span className="tag warn">失效</span>}
                        {e.kind === "handler" && <span className="tag soft">Shell 扩展</span>}
                        {e.shift_only && <span className="tag">Shift</span>}
                        {e.needs_admin && <span className="tag">提权</span>}
                        {e.submenu && <span className="tag">子菜单</span>}
                      </div>
                      <div className="row-sub" title={e.valid ? e.command || e.path : e.invalid_reason}>
                        {e.valid ? e.command || e.path : e.invalid_reason}
                      </div>
                    </div>

                    <div className="row-meta">
                      <span className={e.hive === "HKLM" ? "hive sys" : "hive user"}>{e.hive}</span>
                      <span className="scope">{scopeLabel(e.scope)}</span>
                    </div>

                    <div className="row-actions">
                      <Switch
                        on={e.enabled}
                        disabled={busy || locked}
                        title={locked ? "需要管理员权限" : e.enabled ? "禁用" : "启用"}
                        onClick={() => toggle(e)}
                      />
                      <button
                        className="del-btn"
                        title={locked ? "需要管理员权限" : "删除（自动备份）"}
                        disabled={locked || busy}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setPendingDelete([toTarget(e)]);
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12">
                          <path d="M2.8 2.8l6.4 6.4M9.2 2.8l-6.4 6.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="list">
              {backups.length === 0 && (
                <div className="empty">
                  还没有备份。删除菜单项时会自动备份到
                  <br />
                  %APPDATA%\MenuForge\backups
                </div>
              )}
              {backups.map((b) => (
                <div className="row" key={b.file}>
                  <div className="row-main">
                    <div className="row-title-line">
                      <span className="row-title">{b.title}</span>
                      <span className="tag">{new Date(b.created * 1000).toLocaleString()}</span>
                    </div>
                    <div className="row-sub">{b.path}</div>
                  </div>
                  <div className="row-actions">
                    <button className="ghost-btn" onClick={() => restore(b.file)} disabled={busy}>
                      恢复
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {showCreate && (
        <CreateDialog
          onClose={() => setShowCreate(false)}
          onDone={async () => {
            setShowCreate(false);
            await load();
            say("ok", "菜单项已创建");
          }}
          onError={(t) => say("err", t)}
        />
      )}

      {editingIcon && (
        <IconDialog
          entry={editingIcon}
          onClose={() => setEditingIcon(null)}
          onSave={(v) => saveIcon(editingIcon, v)}
          busy={busy}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.length > 1 ? `删除 ${pendingDelete.length} 个菜单项？` : "删除这个菜单项？"}
          body="删除前会自动备份，可在「备份」页恢复。"
          confirmText="删除"
          danger
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => doDelete(pendingDelete)}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function Switch({
  on,
  onClick,
  disabled,
  title,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={on ? "switch on" : "switch"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      aria-pressed={on}
    >
      <span />
    </button>
  );
}

function Sheet({
  children,
  onClose,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={wide ? "sheet wide" : "sheet"} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmText,
  danger,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet onClose={onCancel}>
      <h2>{title}</h2>
      <p className="sheet-text">{body}</p>
      <div className="sheet-actions">
        <button className="ghost-btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button
          className={danger ? "primary-btn danger" : "primary-btn"}
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmText}
        </button>
      </div>
    </Sheet>
  );
}

function IconDialog({
  entry,
  onClose,
  onSave,
  busy,
}: {
  entry: Entry;
  onClose: () => void;
  onSave: (value: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState(entry.icon);
  return (
    <Sheet onClose={onClose}>
      <h2>修改图标</h2>
      <p className="sheet-text">
        {entry.title} · 支持 exe/dll 路径加索引，例如
        <code>C:\App\app.exe,0</code> 或 <code>%SystemRoot%\system32\shell32.dll,3</code>
      </p>
      <input
        className="field"
        value={value}
        autoFocus
        placeholder="C:\App\app.exe,0"
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="sheet-actions">
        <button className="ghost-btn" onClick={() => onSave("")} disabled={busy}>
          恢复默认
        </button>
        <button className="ghost-btn" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button className="primary-btn" onClick={() => onSave(value)} disabled={busy}>
          保存
        </button>
      </div>
    </Sheet>
  );
}

function CreateDialog({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onError: (text: string) => void;
}) {
  const [form, setForm] = useState<NewEntry>({
    hive: "HKCU",
    scope: "file",
    name: "",
    title: "",
    command: "",
    icon: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<NewEntry>) => setForm({ ...form, ...patch });

  const submit = async () => {
    setSaving(true);
    try {
      await api.create(form);
      await onDone();
    } catch (err) {
      onError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet onClose={onClose} wide>
      <h2>新建菜单项</h2>

      <label className="field-label">
        显示在
        <select className="field" value={form.scope} onChange={(e) => set({ scope: e.target.value })}>
          {SCOPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} — {s.hint}
            </option>
          ))}
        </select>
      </label>

      <div className="grid2">
        <label className="field-label">
          显示名称
          <input
            className="field"
            value={form.title}
            placeholder="用 MenuForge 打开"
            onChange={(e) => set({ title: e.target.value, name: form.name || slug(e.target.value) })}
          />
        </label>
        <label className="field-label">
          注册表标识
          <input
            className="field"
            value={form.name}
            placeholder="MenuForge.Open"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
      </div>

      <label className="field-label">
        命令
        <input
          className="field"
          value={form.command}
          placeholder={'C:\\Program Files\\App\\app.exe "%1"'}
          onChange={(e) => set({ command: e.target.value })}
        />
      </label>

      <label className="field-label">
        图标（可选）
        <input
          className="field"
          value={form.icon}
          placeholder="C:\Program Files\App\app.exe,0"
          onChange={(e) => set({ icon: e.target.value })}
        />
      </label>

      <label className="field-label">
        写入位置
        <select className="field" value={form.hive} onChange={(e) => set({ hive: e.target.value })}>
          <option value="HKCU">当前用户（HKCU，无需管理员）</option>
          <option value="HKLM">所有用户（HKLM，需要管理员）</option>
        </select>
      </label>

      <div className="sheet-actions">
        <button className="ghost-btn" onClick={onClose} disabled={saving}>
          取消
        </button>
        <button
          className="primary-btn"
          onClick={submit}
          disabled={saving || !form.title || !form.command}
        >
          {saving ? "创建中…" : "创建"}
        </button>
      </div>
    </Sheet>
  );
}

function slug(text: string) {
  return text.replace(/\s+/g, "").replace(/[^A-Za-z0-9._-]/g, "");
}
