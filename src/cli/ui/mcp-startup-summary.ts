import { t } from "../../i18n/index.js";

export interface McpStartupSummary {
  total: number;
  connected: number;
  tools: number;
  nativeTools: number;
  activeTools: number;
  maxTools: number;
  disabled: number;
  failed: number;
}

export function formatMcpStartupSummary(summary: McpStartupSummary): string {
  const key =
    summary.disabled > 0 || summary.failed > 0
      ? "mcpLifecycle.startupSummaryIssues"
      : "mcpLifecycle.startupSummary";
  const base = t(key, {
    total: summary.total,
    connected: summary.connected,
    tools: summary.tools,
    disabled: summary.disabled,
    failed: summary.failed,
  });
  return `${base} · ${t("mcpLifecycle.toolBudget", {
    nativeTools: summary.nativeTools,
    mcpTools: summary.tools,
    activeTools: summary.activeTools,
    maxTools: summary.maxTools,
  })}`;
}
