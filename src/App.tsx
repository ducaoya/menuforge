import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  const [showSystem, setShowSystem] = useState(true);
  const [pendingDeleteBackup, setPendingDeleteBackup] = useState<BackupInfo | null>(null);

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
    const un = win.onResized(async () => setMaximized(await win.isMaximized()));
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

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
      if (!showSystem && e.hive === "HKLM") return false;
      if (scope !== "*" && e.scope !== scope) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.command.toLowerCase().includes(q)
      );
    });
  }, [entries, scope, query, showSystem]);

  const groups = useMemo(() => {
    const map = new Map<string, { e: Entry; i: number }[]>();
    visible.forEach((e, i) => {
      const arr = map.get(e.scope) ?? [];
      arr.push({ e, i });
      map.set(e.scope, arr);
    });
    return [...map.entries()];
  }, [visible]);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(keyOf(e))),
    [entries, selected],
  );
  const invalid = useMemo(() => entries.filter((e) => !e.valid), [entries]);

  const toggleMax = async () => {
    await win.toggleMaximize();
    setMaximized(await win.isMaximized());
  };

  const clickRow = (index: number, shift: boolean) => {
    if (visible[index].hive === "HKLM") {
      say("err", "系统级菜单项不支持多选");
      return;
    }
    const k = keyOf(visible[index]);
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

  const removeBackup = async (file: string) => {
    setBusy(true);
    try {
      await api.deleteBackup(file);
      setPendingDeleteBackup(null);
      await loadBackups();
      say("ok", "备份已删除");
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

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const typing = document.activeElement?.tagName === "INPUT";
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !typing) {
        event.preventDefault();
        setSelected(new Set(visible.filter((e) => e.hive === "HKCU").map(keyOf)));
      }
      if (event.key === "Escape") setSelected(new Set());
      if (event.key === "Delete" && selected.size > 0 && !typing) {
        setPendingDelete(selectedEntries.map(toTarget));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, selected, selectedEntries]);

  return (
    <div className={maximized ? "app maximized" : "app"}>
      <header className="titlebar" data-tauri-drag-region onDoubleClick={toggleMax}>
        <div className="brand" data-tauri-drag-region>
          <span className="brand-dot" data-tauri-drag-region />
          <span className="brand-name" data-tauri-drag-region>
            MenuForge
          </span>
        </div>
        <div className="window-actions">
          <button className="win-btn" onClick={() => win.minimize()} title="最小化">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2 5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button className="win-btn" onClick={toggleMax} title={maximized ? "还原" : "最大化"}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="2.4" y="2.4" width="5.2" height="5.2" rx="1.4" stroke="currentColor" strokeWidth="1.1" fill="none" />
            </svg>
          </button>
          <button className="win-btn close" onClick={() => win.close()} title="关闭">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2.6 2.6l4.8 4.8M7.4 2.6L2.6 7.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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

          <div className="side-group">
            <div className="side-row">
              <span>Win11 完整菜单</span>
              <Switch on={classic} onClick={flipClassic} disabled={busy} />
            </div>
            <div className="side-row">
              <span>权限</span>
              {admin ? (
                <b className="pill ok">管理员</b>
              ) : (
                <button
                  className="pill-btn"
                  onClick={() =>
                    api
                      .relaunch()
                      .then(() => say("ok", "已请求提权，请在 UAC 弹窗确认"))
                      .catch((e) => say("err", String(e)))
                  }
                >
                  提权
                </button>
              )}
            </div>
            <div className="side-row">
              <span>失效项</span>
              <div className="side-value">
                <b className={invalid.length ? "pill warn" : "pill ok"}>{invalid.length}</b>
                {invalid.length > 0 && (
                  <button className="pill-btn danger" onClick={cleanup} disabled={busy}>
                    清理
                  </button>
                )}
              </div>
            </div>
          </div>

          <button className="primary-btn" onClick={() => setShowCreate(true)}>
            新建菜单项
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

            {tab === "menu" && selected.size > 0 ? (
              <div className="selection">
                <span className="selection-label">已选</span>
                <span className="selection-count">{selected.size}</span>
                <div className="selection-actions">
                  <button className="pill-btn" onClick={() => setMany(true)} disabled={busy}>
                    启用
                  </button>
                  <button className="pill-btn" onClick={() => setMany(false)} disabled={busy}>
                    禁用
                  </button>
                  <button
                    className="pill-btn danger"
                    onClick={() => setPendingDelete(selectedEntries.map(toTarget))}
                    disabled={busy}
                  >
                    删除
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => setSelected(new Set())}
                    title="取消选择"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <path d="M2.4 2.4l5.2 5.2M7.6 2.4L2.4 7.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : tab === "menu" ? (
              <>
                <div className="search-wrap">
                  <svg width="13" height="13" viewBox="0 0 14 14" className="search-icon">
                    <circle cx="6.2" cy="6.2" r="4.1" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <path d="M9.4 9.4L12.4 12.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <input
                    className="search"
                    placeholder="搜索"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <label className="toolbar-switch" title="显示 HKLM 系统级菜单项">
                  <span>系统项</span>
                  <Switch on={showSystem} onClick={() => setShowSystem(!showSystem)} />
                </label>
                <button className="icon-btn refresh" onClick={() => (load(), loadBackups())} disabled={busy} title="刷新">
                  <svg width="13" height="13" viewBox="0 0 14 14">
                    <path
                      d="M11.4 5.6a4.6 4.6 0 1 0 .2 2.6M11.6 2.6v3.2H8.4"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </button>
              </>
            ) : null}
          </div>

          {tab === "menu" ? (
            <div className="list" ref={listRef}>
              {loading && <div className="empty">正在读取注册表…</div>}
              {!loading && visible.length === 0 && <div className="empty">没有匹配的菜单项</div>}
              {groups.map(([scopeId, items]) => (
                <section className="group" key={scopeId}>
                  {scope === "*" && <h3 className="group-title">{scopeLabel(scopeId)}</h3>}
                  <div className="group-body">
                    {items.map(({ e, i }) => {
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
                              disabled={e.hive === "HKLM"}
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
                            title={
                              e.kind === "handler" ? "图标由扩展 DLL 提供" : "点击修改图标"
                            }
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
                              {e.kind === "handler" && <span className="tag soft">扩展</span>}
                              {e.shift_only && <span className="tag">Shift</span>}
                              {e.needs_admin && <span className="tag">提权</span>}
                            </div>
                            <div
                              className="row-sub"
                              title={e.valid ? e.command || e.path : e.invalid_reason}
                            >
                              {e.valid ? e.command || e.path : e.invalid_reason}
                            </div>
                          </div>

                          <div className="row-meta">
                            <span className={e.hive === "HKLM" ? "hive sys" : "hive user"}>
                              {e.hive === "HKLM" ? "系统" : "用户"}
                            </span>
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
                              <svg width="11" height="11" viewBox="0 0 12 12">
                                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="list">
              {backups.length === 0 ? (
                <div className="empty">
                  还没有备份
                  <br />
                  删除菜单项时会自动备份到 %APPDATA%\MenuForge\backups
                </div>
              ) : (
                <section className="group">
                  <h3 className="group-title">已备份的菜单项</h3>
                  <div className="group-body">
                    {backups.map((b) => (
                      <div className="row" key={b.file}>
                        <div className="row-main backup-main">
                          <div className="row-title-line">
                            <span className="row-title">{b.title}</span>
                            <span className="tag">{new Date(b.created * 1000).toLocaleString()}</span>
                          </div>
                          <div className="row-sub">{b.path}</div>
                        </div>
                        <div className="row-actions">
                          <button className="pill-btn" onClick={() => restore(b.file)} disabled={busy}>
                            恢复
                          </button>
                          <button
                            className="del-btn"
                            title="删除备份"
                            disabled={busy}
                            onClick={() => setPendingDeleteBackup(b)}
                          >
                            <svg width="11" height="11" viewBox="0 0 12 12">
                              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
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
          title={
            pendingDelete.length > 1 ? `删除 ${pendingDelete.length} 个菜单项？` : "删除这个菜单项？"
          }
          body="删除前会自动备份，可在「备份」页恢复。"
          confirmText="删除"
          danger
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => doDelete(pendingDelete)}
        />
      )}

      {pendingDeleteBackup && (
        <ConfirmDialog
          title="删除这条备份？"
          body={`${pendingDeleteBackup.title} · 删除后无法恢复。`}
          confirmText="删除"
          danger
          busy={busy}
          onCancel={() => setPendingDeleteBackup(null)}
          onConfirm={() => removeBackup(pendingDeleteBackup.file)}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`}>
          <span className="toast-icon">
            {toast.kind === "ok" ? (
              <svg width="14" height="14" viewBox="0 0 14 14">
                <circle cx="7" cy="7" r="6.2" fill="currentColor" opacity="0.18" />
                <path d="M4.3 7.2l1.9 1.9 3.5-3.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14">
                <circle cx="7" cy="7" r="6.2" fill="currentColor" opacity="0.18" />
                <path d="M7 4v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="7" cy="10.4" r="0.95" fill="currentColor" />
              </svg>
            )}
          </span>
          <span>{toast.text}</span>
        </div>
      )}
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

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={open ? "select open" : "select"} ref={boxRef}>
      <button className="select-trigger" onClick={() => setOpen(!open)} type="button">
        <span>{current?.label ?? value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="select-caret">
          <path d="M2.4 4l2.6 2.8L7.6 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="select-menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={o.value === value ? "select-item active" : "select-item"}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && (
                <svg width="11" height="11" viewBox="0 0 12 12">
                  <path d="M2.6 6.2l2.2 2.2 4.6-4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
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
        <button className="pill-btn" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button
          className={danger ? "pill-btn danger solid" : "pill-btn solid"}
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
        {entry.title} · 格式为文件路径加索引，例如 <code>C:\App\app.exe,0</code>
      </p>
      <input
        className="field"
        value={value}
        autoFocus
        placeholder="C:\App\app.exe,0"
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="sheet-actions">
        <button className="pill-btn" onClick={() => onSave("")} disabled={busy}>
          恢复默认
        </button>
        <button className="pill-btn" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button className="pill-btn solid" onClick={() => onSave(value)} disabled={busy}>
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

      <div className="grid2">
        <label className="field-label">
          显示名称
          <input
            className="field"
            value={form.title}
            placeholder="用 MenuForge 打开"
            onChange={(e) =>
              set({ title: e.target.value, name: form.name || slug(e.target.value) })
            }
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

      <div className="grid2">
        <label className="field-label">
          图标（可选）
          <input
            className="field"
            value={form.icon}
            placeholder="app.exe,0"
            onChange={(e) => set({ icon: e.target.value })}
          />
        </label>
        <label className="field-label">
          显示在
          <Select
            value={form.scope}
            options={SCOPES.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(v) => set({ scope: v })}
          />
        </label>
      </div>

      <label className="field-label">
        写入位置
        <Select
          value={form.hive}
          options={[
            { value: "HKCU", label: "当前用户（无需管理员）" },
            { value: "HKLM", label: "所有用户（需要管理员）" },
          ]}
          onChange={(v) => set({ hive: v })}
        />
      </label>

      <div className="sheet-actions">
        <button className="pill-btn" onClick={onClose} disabled={saving}>
          取消
        </button>
        <button
          className="pill-btn solid"
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
