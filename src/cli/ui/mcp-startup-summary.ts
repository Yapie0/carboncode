import { t } from "../../i18n/index.js";

export interface McpStartupSummary {
  total: number;
  connected: number;
  tools: number;
  disabled: number;
  failed: number;
}

export function formatMcpStartupSummary(summary: McpStartupSummary): string {
  const key =
    summary.disabled > 0 || summary.failed > 0
      ? "mcpLifecycle.startupSummaryIssues"
      : "mcpLifecycle.startupSummary";
  return t(key, {
    total: summary.total,
    connected: summary.connected,
    tools: summary.tools,
    disabled: summary.disabled,
    failed: summary.failed,
  });
}
