// Carbon Code dashboard SPA — Preact 10 + HTM, bundled by tsup. CDN imports stay external.

import htm from "htm";
import { h, render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { initLangFromServer, t, useLang } from "./src/i18n";
import { MODE, api } from "./src/lib/api";
import { ToastStack, appBus } from "./src/lib/bus";
import { usePoll } from "./src/lib/use-poll";
import { ErrorBoundary, ErrorOverlay } from "./src/lib/error-boundary";
import { ChangesPanel } from "./src/panels/changes";
import { ChatPanel } from "./src/panels/chat";
import { HooksPanel } from "./src/panels/hooks";
import { McpPanel } from "./src/panels/mcp";
import { MemoryPanel } from "./src/panels/memory";
import { OverviewPanel } from "./src/panels/overview";
import { PermissionsPanel } from "./src/panels/permissions";
import { PlansPanel } from "./src/panels/plans";
import { SemanticPanel } from "./src/panels/semantic";
import { SessionsPanel } from "./src/panels/sessions";
import { SettingsPanel } from "./src/panels/settings";
import { SkillsPanel } from "./src/panels/skills";
import { SystemPanel } from "./src/panels/system";
import { ToolsPanel } from "./src/panels/tools";
import { UsagePanel } from "./src/panels/usage";

const html = htm.bind(h);

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("rx.theme");
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* private mode */
    }
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
    return "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("rx.theme", theme);
    } catch {
      /* private mode / disabled storage — ignore */
    }
  }, [theme]);
  return [theme, setTheme];
}

function tabSections() {
  return [
    {
      label: t("app.sectionWorkspace"),
      tabs: [
        { id: "chat", name: t("app.tabChat"), glyph: "◆", panel: () => html`<${ChatPanel} />` },
        { id: "plans", name: t("app.tabPlans"), glyph: "⊞", panel: () => html`<${PlansPanel} />` },
        {
          id: "sessions",
          name: t("app.tabSessions"),
          glyph: "›",
          panel: () => html`<${SessionsPanel} />`,
        },
      ],
    },
    {
      label: t("app.sectionChanges"),
      tabs: [
        {
          id: "changes",
          name: t("app.tabChanges"),
          glyph: "▨",
          panel: () => html`<${ChangesPanel} />`,
        },
      ],
    },
    {
      label: t("app.sectionObserve"),
      tabs: [
        {
          id: "overview",
          name: t("app.tabOverview"),
          glyph: "◈",
          panel: () => html`<${OverviewPanel} />`,
        },
        { id: "usage", name: t("app.tabUsage"), glyph: "$", panel: () => html`<${UsagePanel} />` },
        {
          id: "health",
          name: t("app.tabSystem"),
          glyph: "+",
          panel: () => html`<${SystemPanel} />`,
        },
        {
          id: "semantic",
          name: t("app.tabSemantic"),
          glyph: "≈",
          panel: () => html`<${SemanticPanel} />`,
        },
      ],
    },
    {
      label: t("app.sectionConfigure"),
      tabs: [
        { id: "tools", name: t("app.tabTools"), glyph: "▣", panel: () => html`<${ToolsPanel} />` },
        {
          id: "permissions",
          name: t("app.tabPermissions"),
          glyph: "▎",
          panel: () => html`<${PermissionsPanel} />`,
        },
        { id: "mcp", name: t("app.tabMcp"), glyph: "M", panel: () => html`<${McpPanel} />` },
        {
          id: "skills",
          name: t("app.tabSkills"),
          glyph: "S",
          panel: () => html`<${SkillsPanel} />`,
        },
        {
          id: "memory",
          name: t("app.tabMemory"),
          glyph: "·",
          panel: () => html`<${MemoryPanel} />`,
        },
        { id: "hooks", name: t("app.tabHooks"), glyph: "H", panel: () => html`<${HooksPanel} />` },
        {
          id: "settings",
          name: t("app.tabSettings"),
          glyph: "⌘",
          panel: () => html`<${SettingsPanel} />`,
        },
      ],
    },
  ];
}

function sessLabel(s) {
  const n = (s && s.name) || "";
  return n.length > 30 ? `${n.slice(0, 30)}…` : n;
}

// Simple-mode left rail: a ChatGPT-style conversation sidebar backed by the
// existing /sessions API (list · new · switch). Replaces the panel-nav aside
// when in simple mode so the chat reads like a dedicated chat app.
function SimpleSidebar() {
  useLang();
  const { data, refresh } = usePoll("/sessions", 5000);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const sessions = ((data && data.sessions) || []).filter(
    (s) => !((s && s.name) || "").startsWith("subagent"),
  );
  const current = (data && data.currentSession) || null;
  const filtered = q
    ? sessions.filter((s) => ((s && s.name) || "").toLowerCase().includes(q.toLowerCase()))
    : sessions;
  const newChat = useCallback(async () => {
    setBusy(true);
    try {
      await api("/sessions/new", { method: "POST" });
      await refresh();
    } catch {
      /* ignore — server surfaces errors elsewhere */
    } finally {
      setBusy(false);
    }
  }, [refresh]);
  const switchTo = useCallback(
    async (name) => {
      try {
        await api(`/sessions/${encodeURIComponent(name)}/switch`, { method: "POST" });
        await refresh();
      } catch {
        /* ignore */
      }
    },
    [refresh],
  );
  return html`
    <div class="cc-sb">
      <div class="cc-sb-head"><span class="cc-wordmark">Carbon Code</span></div>
      <div class="cc-sb-nav">
        <button class="cc-sb-item" onClick=${newChat} disabled=${busy}>
          <span class="cc-ico">✎</span><span class="lbl">${t("chat.newChat")}</span>
        </button>
        <label class="cc-sb-find">
          <span class="cc-ico">⌕</span>
          <input
            placeholder=${t("chat.searchChats")}
            value=${q}
            onInput=${(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <div class="cc-sb-recent">
        ${filtered.length > 0 ? html`<div class="cc-sb-sec">${t("chat.recent")}</div>` : null}
        ${filtered.map(
          (s) => html`
            <button
              class=${`cc-sb-chat ${s.name === current ? "active" : ""}`}
              onClick=${() => switchTo(s.name)}
              title=${s.name}
            >
              <span class="t">${sessLabel(s)}</span>
            </button>
          `,
        )}
      </div>
      <div class="cc-sb-user">
        <span class="cc-avatar">C</span>
        <span class="who"><span class="nm">Carbon Code</span><span class="pl">${MODE}</span></span>
      </div>
    </div>
  `;
}

function App() {
  useLang();
  useEffect(() => {
    initLangFromServer();
  }, []);
  const [activeId, setActiveId] = useState(() => {
    try {
      return localStorage.getItem("rx.activeTab") ?? "chat";
    } catch {
      return "chat";
    }
  });
  const [theme, setTheme] = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("rx.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  // Simple (chat-first) mode hides the sidebar / stats / mode buttons and shows
  // just the conversation. Default ON; the ⚙ in the top bar reveals everything.
  const [simple, setSimple] = useState(() => {
    try {
      return (localStorage.getItem("rx.simpleMode") ?? "1") === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("rx.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      /* private mode / disabled storage — ignore */
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    try {
      localStorage.setItem("rx.simpleMode", simple ? "1" : "0");
    } catch {
      /* private mode / disabled storage — ignore */
    }
  }, [simple]);
  useEffect(() => {
    try {
      localStorage.setItem("rx.activeTab", activeId);
    } catch {
      /* private mode / disabled storage — ignore */
    }
  }, [activeId]);
  const TAB_SECTIONS = tabSections();
  const ALL_TABS = TAB_SECTIONS.flatMap((s) => s.tabs);
  const active = ALL_TABS.find((t) => t.id === activeId) ?? ALL_TABS[0];
  // In simple mode only the chat view is reachable (no sidebar to switch tabs).
  const chatTab = ALL_TABS.find((tab) => tab.id === "chat") ?? ALL_TABS[0];
  const view = simple ? chatTab : active;
  useEffect(() => {
    if (active.id !== activeId) setActiveId(active.id);
  }, [active.id, activeId]);

  useEffect(() => {
    const onNav = (ev) => {
      const id = ev.detail?.tabId;
      if (id) {
        setActiveId(id);
        if (id !== "chat") setSimple(false);
      }
    };
    appBus.addEventListener("navigate-tab", onNav);
    return () => appBus.removeEventListener("navigate-tab", onNav);
  }, []);

  const pickTab = useCallback((id) => setActiveId(id), []);

  return html`
    <div class=${`app ${sidebarCollapsed ? "collapsed" : ""} ${simple ? "simple" : ""}`}>
      <aside class="app-side">
        ${
          simple
            ? html`<${SimpleSidebar} />`
            : html`
        <div class="brand">
          <span class="glyph">◈</span>
          <span class="label">CARBON CODE</span>
          <span class="ver">${MODE}</span>
        </div>
        <div class="side-tabs">
          ${TAB_SECTIONS.map(
            (section) => html`
              <div class="side-section">${section.label}</div>
              ${section.tabs.map(
                (tab) => html`
                  <div
                    class=${`side-tab ${tab.id === active.id ? "active" : ""}`}
                    onClick=${() => pickTab(tab.id)}
                    title=${tab.name}
                  >
                    <span class="g">${tab.glyph}</span>
                    <span class="label">${tab.name}</span>
                  </div>
                `,
              )}
            `,
          )}
        </div>
        <div class="side-foot">
          <span class="label">127.0.0.1</span>
          <span
            class="toggle theme-toggle"
            title=${t("app.themeToggle") + (theme === "dark" ? ` (${t("app.themeLight")})` : ` (${t("app.themeDark")})`)}
            onClick=${() => setTheme(theme === "dark" ? "light" : "dark")}
          >${theme === "dark" ? "☀" : "☾"}</span>
          <span
            class="toggle"
            title=${sidebarCollapsed ? "expand" : "collapse"}
            onClick=${() => setSidebarCollapsed((c) => !c)}
          >${sidebarCollapsed ? "»" : "«"}</span>
          <span
            class="toggle"
            title=${t("app.toSimple")}
            onClick=${() => setSimple(true)}
          >◐</span>
        </div>
        `
        }
      </aside>
      <header class="app-top">
        ${
          simple
            ? html`
              <span class="ws">
                <span class="glyph" style="color:var(--c-brand);font-size:15px">◈</span>
                <span class="brandname">Carbon Code</span>
              </span>
              <span class="grow"></span>
              <span
                class="toggle"
                title=${t("app.themeToggle")}
                onClick=${() => setTheme(theme === "dark" ? "light" : "dark")}
              >${theme === "dark" ? "☀" : "☾"}</span>
              <span
                class="toggle"
                title=${t("app.toAdvanced")}
                onClick=${() => setSimple(false)}
              >⚙</span>
            `
            : html`
              <span class="ws">
                <span class="path">dashboard</span>
                <span class="sep">·</span>
                <span class="branch">${MODE}</span>
              </span>
              <span class="grow"></span>
            `
        }
      </header>
      <div class="app-body">
        <${ErrorBoundary}>${view.panel()}<//>
      </div>
      <footer class="app-status">
        <span class="grow"></span>
        <span class="item">${t("app.footer")}</span>
      </footer>
    </div>
    <${ToastStack} />
    <${ErrorOverlay} />
  `;
}

render(html`<${App} />`, document.getElementById("root"));
