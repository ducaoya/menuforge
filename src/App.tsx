import { useCallback, useEffect, useMemo, useState } from "react";
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

const scopeLabel = (id: string) =>
  SCOPES.find((s) => s.id === id)?.label ?? id;

const keyOf = (e: Entry) => `${e.hive}|${e.path}|${e.kind}`;

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scope, setScope] = useState<string>("*");
  const [query, setQuery] = useState("");
  const [admin, setAdmin] = useState(false);
  const [classic, setClassic] = useState(false);
  const [tab, setTab] = useState<Tab>("menu");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);

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

  const remove = async (e: Entry) => {
    setBusy(true);
    try {
      await api.remove(toTarget(e));
      setConfirming(null);
      await Promise.all([load(), loadBackups()]);
      say("ok", `已删除「${e.title}」，可在备份中恢复`);
    } catch (err) {
      say("err", String(err));
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" />
          <div>
            <h1>MenuForge</h1>
            <p>Windows 右键菜单管理器</p>
          </div>
        </div>

        <div className="topbar-actions">
          {!admin && (
            <button
              className="btn btn-warn"
              onClick={() =>
                api
                  .relaunch()
                  .then(() => say("ok", "已请求提权，请在 UAC 弹窗中确认"))
                  .catch((e) => say("err", String(e)))
              }
            >
              以管理员身份重启
            </button>
          )}
          <button className="btn" onClick={() => (load(), loadBackups())} disabled={busy}>
            刷新
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + 新建菜单项
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

          <div className="sidebar-cards">
            <div className="card">
              <div className="card-head">
                <span>Win11 完整右键菜单</span>
                <Switch on={classic} onClick={flipClassic} disabled={busy} />
              </div>
              <p>
                {classic
                  ? "当前显示 Windows 10 风格的完整菜单"
                  : "当前显示 Win11 精简菜单，开启后恢复全部旧项"}
              </p>
            </div>

            <div className="card">
              <div className="card-head">
                <span>权限状态</span>
                <b className={admin ? "ok" : "warn"}>{admin ? "管理员" : "受限"}</b>
              </div>
              <p>
                {admin
                  ? "可修改系统级（HKLM）菜单项"
                  : "系统级菜单项只能查看，切换/删除需管理员权限"}
              </p>
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="toolbar">
            <div className="tabs">
              <button
                className={tab === "menu" ? "tab active" : "tab"}
                onClick={() => setTab("menu")}
              >
                菜单项
              </button>
              <button
                className={tab === "backups" ? "tab active" : "tab"}
                onClick={() => (setTab("backups"), loadBackups())}
              >
                备份 {backups.length > 0 && <em>{backups.length}</em>}
              </button>
            </div>
            {tab === "menu" && (
              <input
                className="search"
                placeholder="搜索名称 / 命令"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
          </div>

          {tab === "menu" ? (
            <div className="list">
              {loading && <div className="empty">正在读取注册表…</div>}
              {!loading && visible.length === 0 && (
                <div className="empty">没有匹配的菜单项</div>
              )}
              {visible.map((e) => {
                const id = keyOf(e);
                const locked = !e.writable;
                return (
                  <div className={e.enabled ? "row" : "row off"} key={id}>
                    <div className="row-title-line">
                      <span className="row-title">{e.title}</span>
                      {e.shift_only && <span className="chip">Shift 才显示</span>}
                      {e.needs_admin && <span className="chip">提权</span>}
                      {e.submenu && <span className="chip">子菜单</span>}
                      {e.kind === "handler" && (
                        <span className="chip chip-soft">Shell 扩展</span>
                      )}
                    </div>
                    <div className="row-sub" title={e.command || e.path}>
                      {e.command || e.path}
                    </div>
                    <div className="row-meta">
                      <span className={e.hive === "HKLM" ? "hive sys" : "hive user"}>
                        {e.hive}
                      </span>
                      <span className="scope">{scopeLabel(e.scope)}</span>
                    </div>
                    <div className="row-actions">
                      {confirming === id ? (
                        <>
                          <button
                            className="btn btn-danger sm"
                            onClick={() => remove(e)}
                            disabled={busy}
                          >
                            确认删除
                          </button>
                          <button
                            className="btn sm"
                            onClick={() => setConfirming(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <Switch
                            on={e.enabled}
                            disabled={busy || locked}
                            title={locked ? "需要管理员权限" : undefined}
                            onClick={() => toggle(e)}
                          />
                          <button
                            className="icon-btn"
                            title={locked ? "需要管理员权限" : "删除（自动备份）"}
                            disabled={locked || busy}
                            onClick={() => setConfirming(id)}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="list">
              {backups.length === 0 && (
                <div className="empty">还没有备份。删除菜单项时会自动备份到 %APPDATA%\MenuForge\backups</div>
              )}
              {backups.map((b) => (
                <div className="row" key={b.file}>
                  <div className="row-title-line">
                    <span className="row-title">{b.title}</span>
                    <span className="chip">
                      {new Date(b.created * 1000).toLocaleString()}
                    </span>
                  </div>
                  <div className="row-sub">{b.path}</div>
                  <div className="row-actions">
                    <button
                      className="btn sm"
                      onClick={() => restore(b.file)}
                      disabled={busy}
                    >
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

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function toTarget(e: Entry): Target {
  return {
    hive: e.hive,
    path: e.path,
    kind: e.kind,
    name: e.name,
    clsid: e.clsid,
  };
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
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
    >
      <span />
    </button>
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
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>新建菜单项</h2>

        <label>
          显示在
          <select value={form.scope} onChange={(e) => set({ scope: e.target.value })}>
            {SCOPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} — {s.hint}
              </option>
            ))}
          </select>
        </label>

        <div className="grid2">
          <label>
            显示名称
            <input
              value={form.title}
              placeholder="用 MenuForge 打开"
              onChange={(e) => set({ title: e.target.value, name: form.name || slug(e.target.value) })}
            />
          </label>
          <label>
            注册表标识
            <input
              value={form.name}
              placeholder="MenuForge.Open"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
        </div>

        <label>
          命令
          <input
            value={form.command}
            placeholder={'"C:\\Program Files\\App\\app.exe" "%1"'}
            onChange={(e) => set({ command: e.target.value })}
          />
        </label>

        <label>
          图标（可选）
          <input
            value={form.icon}
            placeholder="C:\Program Files\App\app.exe,0"
            onChange={(e) => set({ icon: e.target.value })}
          />
        </label>

        <label>
          写入位置
          <select value={form.hive} onChange={(e) => set({ hive: e.target.value })}>
            <option value="HKCU">当前用户（HKCU，无需管理员）</option>
            <option value="HKLM">所有用户（HKLM，需要管理员）</option>
          </select>
        </label>

        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={saving || !form.title || !form.command}
          >
            {saving ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

function slug(text: string) {
  return text.replace(/\s+/g, "").replace(/[^A-Za-z0-9._-]/g, "");
}
