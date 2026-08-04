import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { BootSplash } from "../src/cli/ui/BootSplash.js";
import { EditConfirm } from "../src/cli/ui/EditConfirm.js";
import { PromptInput } from "../src/cli/ui/PromptInput.js";
import { ShellConfirm } from "../src/cli/ui/ShellConfirm.js";
import { WelcomeBanner } from "../src/cli/ui/WelcomeBanner.js";
import { CardRenderer } from "../src/cli/ui/cards/CardRenderer.js";
import { ReasoningCard } from "../src/cli/ui/cards/ReasoningCard.js";
import { StreamingCard } from "../src/cli/ui/cards/StreamingCard.js";
import { ToolCard } from "../src/cli/ui/cards/ToolCard.js";
import { UserCard } from "../src/cli/ui/cards/UserCard.js";
import { CardStream } from "../src/cli/ui/layout/CardStream.js";
import { ModeStatusBar, UndoBanner } from "../src/cli/ui/layout/LiveRows.js";
import { StatusRow } from "../src/cli/ui/layout/StatusRow.js";
import type { Card, ReasoningCard as ReasoningCardData } from "../src/cli/ui/state/cards.js";
import { AgentStoreProvider, useAgentStore } from "../src/cli/ui/state/provider.js";
import type { AgentState, SessionInfo } from "../src/cli/ui/state/state.js";
import { setLanguageRuntime, t } from "../src/i18n/index.js";

function settledReasoning(text: string): ReasoningCardData {
  return {
    kind: "reasoning",
    id: "r1",
    ts: 1,
    endedAt: 2001,
    text,
    paragraphs: 1,
    tokens: 64,
    streaming: false,
    model: "deepseek-v4-pro",
  };
}

const SESSION: SessionInfo = {
  id: "default",
  branch: "main",
  workspace: "/repo",
  model: "deepseek-v4-pro",
};

function StateInjector({
  overrides,
  children,
}: {
  overrides: Partial<AgentState["status"]>;
  children: React.ReactNode;
}): React.ReactElement {
  const store = useAgentStore();
  React.useEffect(() => {
    store.dispatch({ type: "session.update", patch: overrides } as never);
  }, [store, overrides]);
  return <>{children}</>;
}

describe("Codex-style terminal surface", () => {
  it("uses a compact boot splash instead of a full-screen logo scene", () => {
    const { lastFrame, unmount } = render(<BootSplash />);
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("Carbon Code");
    expect(out).not.toContain("████");
    expect(out).not.toContain("_____");
    expect(out).not.toContain("░");
  });

  it("shows a Claude-style welcome box with a /help tip, still task-first", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <WelcomeBanner inCodeMode workspaceRoot="/repo" dashboardUrl={null} />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("Carbon Code");
    expect(out).toContain("/repo");
    expect(out).toContain("/help");
    // Rounded welcome box.
    expect(out).toContain("╭");
    // ...but no marketing/product-card noise.
    expect(out).not.toContain("DeepSeek");
    expect(out).not.toContain("🐋");
  });

  it("keeps dashboard URLs out of the default welcome timeline", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <WelcomeBanner
        inCodeMode
        workspaceRoot="/repo"
        dashboardUrl="http://127.0.0.1:3000/?token=secret"
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("/repo");
    expect(out).not.toContain("127.0.0.1");
    expect(out).not.toContain("token=");
    expect(out).not.toContain("网页");
  });

  it("renders the composer as a Claude-style bordered prompt without a persistent shortcut button row", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <PromptInput value="" onChange={() => {}} onSubmit={() => {}} />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain(">");
    expect(out).toContain("输入任务");
    // Claude-style rounded input box.
    expect(out).toContain("╭");
    // ...but still no persistent shortcut button row.
    expect(out).not.toContain("^U");
    expect(out).not.toContain("^P/^N");
    expect(out).not.toContain("^C");
  });

  it("renders user turns without timestamp chrome", () => {
    const { lastFrame, unmount } = render(
      <UserCard
        card={{
          kind: "user",
          id: "u1",
          ts: Date.now(),
          text: "帮我修改这个函数",
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("帮我修改这个函数");
    expect(out).not.toContain("just now");
    expect(out).not.toContain("◇");
    expect(out).not.toContain("↳");
  });

  it("does not show reasoning body by default", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <ReasoningCard
        card={settledReasoning("Let me read these files and decide what to do next.")}
        expanded={false}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("推理");
    expect(out).not.toContain("Let me read");
    expect(out).not.toContain("v4-pro");
    expect(out).not.toContain("tok");
  });

  it("keeps normal timeline rendering from expanding reasoning text", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <CardRenderer
        card={settledReasoning("Let me read these files and decide what to do next.")}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("推理");
    expect(out).not.toContain("Let me read");
  });

  it("can render a fully quiet bottom status row", async () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <AgentStoreProvider session={SESSION}>
        <StateInjector overrides={{ cost: 0.01, promptTokens: 2000, preset: "pro" }}>
          <StatusRow
            statusBar={
              {
                showMode: false,
                showPreset: false,
                showSessionInfo: false,
                showBalance: false,
                showSessionCost: false,
                showTurnCost: false,
                showCacheHit: false,
                showCtxUsage: false,
                showVersion: false,
                showFeedbackHint: false,
              } as never
            }
          />
        </StateInjector>
      </AgentStoreProvider>,
    );
    await new Promise((r) => setTimeout(r, 250));
    const out = lastFrame() ?? "";
    unmount();

    expect(out).not.toContain("编辑");
    expect(out).not.toContain("default · main");
    expect(out).not.toContain("pro");
    expect(out).not.toContain("上下文");
  });

  it("keeps streaming output headers free of model and preview chips", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <StreamingCard
        card={{
          kind: "streaming",
          id: "s1",
          ts: Date.now() - 1000,
          text: "@carboncode/cli",
          done: false,
          model: "deepseek-v4-pro",
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("输出");
    expect(out).not.toContain("preview");
    expect(out).not.toContain("expanded");
    expect(out).not.toContain("v4-pro");
    expect(out).not.toContain("t/s");
  });

  it("keeps assistant text stable while streaming instead of tail-folding it", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <StreamingCard
        card={{
          kind: "streaming",
          id: "s1",
          ts: Date.now() - 1000,
          text: ["first line", "second line", "third line", "fourth line", "fifth line"].join("\n"),
          done: false,
          model: "deepseek-v4-pro",
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("first line");
    expect(out).toContain("fifth line");
    expect(out).not.toContain("earlier");
    expect(out).not.toContain("更早");
  });

  it("keeps every line of a long live streaming reply visible", () => {
    setLanguageRuntime("en");
    const text = Array.from(
      { length: 20 },
      (_, i) => `line ${String(i + 1).padStart(2, "0")}`,
    ).join("\n");
    const { lastFrame, unmount } = render(
      <StreamingCard
        card={{
          kind: "streaming",
          id: "s1",
          ts: Date.now() - 1000,
          text,
          done: false,
          model: "deepseek-v4-pro",
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("line 01");
    expect(out).toContain("line 08");
    expect(out).toContain("line 12");
    expect(out).toContain("line 20");
    expect(out).not.toContain("earlier");
  });

  it("shows the user prompt context on assistant reply cards", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <StreamingCard
        card={{
          kind: "streaming",
          id: "s1",
          ts: Date.now() - 1000,
          text: "可以，先看 PR 列表。",
          done: true,
          userPrompt: "帮我看一下当前 open PR",
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("帮我看一下当前 open PR");
    expect(out).toContain("可以，先看 PR 列表。");
  });

  it("shows successful read tools as a compact action, not a file preview dump", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <ToolCard
        card={{
          kind: "tool",
          id: "tool1",
          ts: 1,
          name: "read_file",
          args: { path: "package.json" },
          output: ["{", '  "name": "@carboncode/cli",', '  "version": "0.1.0",', "}"].join("\n"),
          done: true,
          exitCode: 0,
          elapsedMs: 20,
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("Read"); // friendly tool name (was raw "read_file")
    expect(out).toContain("package.json");
    expect(out).not.toContain("@carboncode/cli");
    expect(out).not.toContain('"version"');
  });

  it("keeps every card in an active turn visible", () => {
    setLanguageRuntime("en");
    const liveCards: Card[] = [
      {
        kind: "reasoning",
        id: "reasoning-live",
        ts: 1,
        text: "I am still thinking through the earlier edits.",
        paragraphs: 1,
        tokens: 12,
        streaming: true,
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        kind: "tool" as const,
        id: `tool-${i}`,
        ts: i + 2,
        name: "write_file",
        args: { path: `src/file-${i}.ts` },
        output: `verbose body from tool ${i}`,
        done: true,
        exitCode: 0,
        elapsedMs: 20,
      })),
    ];
    const { lastFrame, unmount } = render(
      <AgentStoreProvider session={SESSION} initialCards={liveCards}>
        <CardStream />
      </AgentStoreProvider>,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).not.toContain("+3");
    expect(out).toContain("src/file-0.ts");
    expect(out).toContain("src/file-5.ts");
    expect(out).not.toContain("verbose body from tool 5");
  });

  it("keeps the latest user prompt visible when an older active plan keeps the turn live", () => {
    setLanguageRuntime("en");
    const liveCards: Card[] = [
      {
        kind: "plan",
        id: "plan-active",
        ts: 1,
        title: "Teams MVP",
        variant: "active",
        steps: [
          { id: "s1", title: "done step", status: "done" },
          { id: "s2", title: "queued step", status: "queued" },
        ],
      },
      {
        kind: "user",
        id: "user-latest",
        ts: 2,
        text: "teams这些的操作有没有help或者文档之类的说明？",
      },
      {
        kind: "streaming",
        id: "reply-table",
        ts: 3,
        text: ["| Name | Value |", "| --- | --- |", "| alpha | beta |"].join("\n"),
        done: true,
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        kind: "tool" as const,
        id: `tool-after-user-${i}`,
        ts: i + 4,
        name: "run_command",
        args: { command: `echo ${i}` },
        output: `verbose output ${i}`,
        done: true,
        exitCode: 0,
        elapsedMs: 20,
      })),
      {
        kind: "streaming",
        id: "reply-live",
        ts: 20,
        text: "全部通过。现在 Teams 有三层帮助。",
        done: false,
        userPrompt: "teams这些的操作有没有help或者文档之类的说明？",
      },
    ];
    const { lastFrame, unmount } = render(
      <AgentStoreProvider session={SESSION} initialCards={liveCards}>
        <CardStream />
      </AgentStoreProvider>,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("> teams这些的操作有没有help或者文档之类的说明？");
    expect(out).not.toMatch(/\+\d+\s+more/);
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("echo 0");
    expect(out).toContain("echo 5");
    expect(out).toContain("全部通过。现在 Teams 有三层帮助。");
  });

  it("keeps failed shell summaries ahead of tail output", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <ToolCard
        card={{
          kind: "tool",
          id: "tool-fail",
          ts: 1,
          name: "run_command",
          args: { command: "npm test" },
          output: [
            "FAIL tests/alpha.test.ts > alpha",
            "FAIL tests/beta.test.ts > beta",
            "FAIL tests/gamma.test.ts > gamma",
            "FAIL tests/delta.test.ts > delta",
            "FAIL tests/epsilon.test.ts > epsilon",
            "FAIL tests/zeta.test.ts > zeta",
            "Tests 6 failed",
            "Test Files 6 failed (6)",
            "[exit code 1]",
          ].join("\n"),
          done: true,
          exitCode: 1,
          elapsedMs: 20,
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("6 failed");
    expect(out).toContain("tests/zeta.test.ts");
    expect(out).not.toContain("earlier");
    expect(out).not.toContain("更早");
  });

  it("keeps edit review hints compact instead of exposing every mode shortcut", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <EditConfirm
        block={{
          path: "src/cart.js",
          search: "return item.price;",
          replace: "return item.price * item.quantity;",
          offset: 0,
        }}
        onChoose={() => {}}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("Enter");
    expect(out).not.toContain("应用剩余");
    expect(out).not.toContain("切换 AUTO");
  });

  it("renders multi-file edit review as one batch", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <EditConfirm
        blocks={[
          {
            path: "src/cart.js",
            search: "return 1;\n",
            replace: "return 2;\n",
            offset: 0,
          },
          {
            path: "test/cart.test.js",
            search: "assert.equal(total(), 1);\n",
            replace: "assert.equal(total(), 2);\n",
            offset: 0,
          },
        ]}
        onChoose={() => {}}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("2 files");
    expect(out).toContain("src/cart.js");
    expect(out).toContain("test/cart.test.js");
  });

  it("keeps shell confirmation compact", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <ShellConfirm
        command="npm test"
        allowPrefix="npm test"
        cwd="/repo"
        timeoutSec={120}
        onChoose={() => {}}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).toContain("$ npm test");
    expect(out).toContain("允许一次");
    expect(out).not.toContain("模型请求执行 Shell 命令");
    expect(out).not.toContain("执行此命令，下次再问");
    expect(out).not.toContain("按 Tab 添加说明");
    expect(t("shellConfirm.pickFooter")).not.toContain("Tab");
    expect(t("shellConfirm.pickFooter")).not.toContain("说明");
    setLanguageRuntime("en");
    expect(t("shellConfirm.pickFooter")).not.toContain("Tab");
  });

  it("does not show a stale review bar when no edits are pending", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <ModeStatusBar editMode="review" pendingCount={0} flash={false} planMode={false} />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out.trim()).toBe("");
  });

  it("uses a quiet undo banner label instead of AUTO-APPLIED chrome", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(
      <UndoBanner
        banner={{
          results: [{ path: "src/cart.js", status: "applied" }],
          expiresAt: Date.now() + 5000,
          pausedRemainingMs: null,
        }}
      />,
    );
    const out = lastFrame() ?? "";
    unmount();

    expect(out).not.toContain("AUTO-APPLIED");
    expect(out).toContain("已应用");
  });
});
