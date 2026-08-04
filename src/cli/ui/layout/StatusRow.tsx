import { Box, Text, useStdout } from "ink";
import React from "react";
import type { EditMode } from "../../../config.js";
import { t } from "../../../i18n/index.js";
import { FLASH_MODEL_ID, PRO_MODEL_ID } from "../../../models.js";
import { contextTokensFor } from "../../../telemetry/stats.js";
import { VERSION } from "../../../version.js";
import { formatTokens } from "../primitives.js";
import { Countdown } from "../primitives/Countdown.js";
import { useAgentState } from "../state/provider.js";
import type { Mode, NetworkState, StatusBar } from "../state/state.js";
import { GLYPH } from "../theme.js";
import { FG, TONE, balanceColor, formatBalance, formatCost } from "../theme/tokens.js";

export interface StatusBarConfig {
  showMode: boolean;
  showPreset: boolean;
  showSessionInfo: boolean;
  showBalance: boolean;
  showSessionCost: boolean;
  showTurnCost: boolean;
  showCacheHit: boolean;
  showCtxUsage: boolean;
  showVersion: boolean;
  showFeedbackHint: boolean;
}

const WALLET_MIN_COLS = 90;
const VERSION_MIN_COLS = 70;
const FEEDBACK_HINT_MIN_COLS = 100;
const CTX_TOKENS_MIN_COLS = 90;
const CTX_BAR_MIN_COLS = 110;
const CTX_BAR_CELLS = 8;

const DEFAULT_STATUS_BAR_CONFIG: StatusBarConfig = {
  showMode: true,
  showPreset: true,
  showSessionInfo: true,
  showBalance: true,
  showSessionCost: true,
  showTurnCost: true,
  showCacheHit: true,
  showCtxUsage: true,
  showVersion: true,
  showFeedbackHint: true,
};

export function resolveRuntimeStatusBarConfig(cfg: Partial<StatusBarConfig> = {}): StatusBarConfig {
  return {
    showMode: cfg.showMode === true,
    showPreset: cfg.showPreset !== false,
    showSessionInfo: cfg.showSessionInfo === true,
    showBalance: cfg.showBalance === true,
    showSessionCost: cfg.showSessionCost !== false,
    showTurnCost: cfg.showTurnCost !== false,
    showCacheHit: cfg.showCacheHit === true,
    showCtxUsage: cfg.showCtxUsage !== false,
    showVersion: cfg.showVersion === true,
    showFeedbackHint: cfg.showFeedbackHint === true,
  };
}

export function StatusRow({
  statusBar = DEFAULT_STATUS_BAR_CONFIG,
  editMode,
  planMode = false,
  collabAgent,
  modelProfileId,
}: {
  statusBar?: StatusBarConfig;
  editMode?: EditMode;
  planMode?: boolean;
  collabAgent?: string;
  modelProfileId?: string;
}): React.ReactElement {
  const status = useAgentState((s) => s.status);
  const session = useAgentState((s) => s.session);
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const hasTurn = status.cost > 0;
  const hasSession = status.sessionCost > 0;
  const hasBalance = typeof status.balance === "number";
  const showWallet = cols >= WALLET_MIN_COLS && hasBalance && statusBar.showBalance;
  const segments: Array<{ key: string; node: React.ReactNode }> = [];

  if (statusBar.showMode) {
    segments.push({
      key: "mode",
      node: status.recording ? (
        <RecordingPill rec={status.recording} />
      ) : status.countdownSeconds !== undefined ? (
        <CountdownRow mode={status.mode} secondsLeft={status.countdownSeconds} />
      ) : (
        <ModePill mode={status.mode} network={status.network} detail={status.networkDetail} />
      ),
    });
  }
  if (statusBar.showPreset) {
    segments.push({
      key: "model",
      node: <ModelPill model={session.model} profileId={modelProfileId} />,
    });
  }
  if (editMode) {
    segments.push({
      key: "editMode",
      node: <EditModePill editMode={editMode} planMode={planMode} />,
    });
  }
  if (collabAgent) {
    segments.push({
      key: "collab",
      node: <CollabPill agent={collabAgent} />,
    });
  }
  if (statusBar.showSessionInfo) {
    segments.push({
      key: "session",
      node: <Text color={FG.sub}>{`${session.id} · ${session.branch}`}</Text>,
    });
  }
  if (hasTurn && statusBar.showTurnCost) {
    segments.push({
      key: "turn",
      node: (
        <>
          <Text bold color={TONE.brand}>
            {"▸ "}
          </Text>
          <Text bold color={FG.body}>
            {`${formatCost(status.cost, status.balanceCurrency)} ${t("statusBar.turn")}`}
          </Text>
        </>
      ),
    });
  }
  if (hasSession && statusBar.showSessionCost) {
    segments.push({
      key: "sessionCost",
      node: (
        <>
          <Text bold color={TONE.accent}>
            {"Σ "}
          </Text>
          <Text bold color={FG.body}>
            {`${formatCost(status.sessionCost, status.balanceCurrency, 2)} ${t("statusBar.session")}`}
          </Text>
        </>
      ),
    });
  }
  if (statusBar.showCacheHit) {
    segments.push({
      key: "cache",
      node: (
        <Text color={TONE.accent}>
          {`${t("statusBar.cache")} ${Math.round(status.cacheHit * 100)}%`}
        </Text>
      ),
    });
  }
  if (statusBar.showCtxUsage && status.promptTokens !== undefined && status.promptTokens > 0) {
    segments.push({
      key: "ctx",
      node: (
        <CtxUsagePill
          tokens={status.promptTokens}
          cap={status.promptCap ?? contextTokensFor(session.model)}
          cols={cols}
        />
      ),
    });
  }
  if (status.mcpLoading && status.mcpLoading.ready < status.mcpLoading.total) {
    segments.push({
      key: "mcp",
      node: <McpLoadingPill ready={status.mcpLoading.ready} total={status.mcpLoading.total} />,
    });
  }
  if (showWallet) {
    segments.push({
      key: "wallet",
      node: <WalletPill balance={status.balance} currency={status.balanceCurrency} />,
    });
  }
  if (statusBar.showVersion && cols >= VERSION_MIN_COLS) {
    segments.push({ key: "version", node: <Text color={FG.faint}>{`v${VERSION}`}</Text> });
  }
  if (statusBar.showFeedbackHint && cols >= FEEDBACK_HINT_MIN_COLS) {
    segments.push({
      key: "feedback",
      node: (
        <>
          <Text color={FG.meta}>{"⚑ "}</Text>
          <Text color={FG.sub}>{"/feedback"}</Text>
        </>
      ),
    });
  }

  if (segments.length === 0) return <Box flexDirection="column" flexShrink={0} />;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" flexWrap="wrap" flexShrink={0}>
        <Text>{"  "}</Text>
        {segments.map((segment, index) => (
          <React.Fragment key={segment.key}>
            {index > 0 ? <Sep /> : null}
            {segment.node}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

function ModelPill({
  model,
  profileId,
}: {
  model: string;
  profileId?: string;
}): React.ReactElement {
  const label = profileId ?? shortModelLabel(model);
  return (
    <>
      <Text color={FG.meta} wrap="truncate">
        {"model "}
      </Text>
      <Text color={TONE.accent} bold wrap="truncate">
        {label}
      </Text>
    </>
  );
}

function shortModelLabel(model: string): string {
  if (model === FLASH_MODEL_ID) return "flash";
  if (model === PRO_MODEL_ID) return "pro";
  return model.replace(/^deepseek-/, "");
}

function EditModePill({
  editMode,
  planMode,
}: {
  editMode: EditMode;
  planMode: boolean;
}): React.ReactElement {
  const label = planMode ? "plan" : editMode;
  const color =
    planMode || editMode === "yolo" ? TONE.err : editMode === "auto" ? TONE.accent : TONE.brand;
  return (
    <>
      <Text color={FG.meta}>{"mode "}</Text>
      <Text color={color} bold>
        {label}
      </Text>
    </>
  );
}

function CollabPill({ agent }: { agent: string }): React.ReactElement {
  return (
    <>
      <Text color={FG.meta}>{"collab "}</Text>
      <Text color={TONE.accent} bold>
        {agent}
      </Text>
    </>
  );
}

function CtxUsagePill({
  tokens,
  cap,
  cols,
}: {
  tokens: number;
  cap: number;
  cols: number;
}): React.ReactElement {
  const ratio = cap > 0 ? Math.min(1, tokens / cap) : 0;
  const pct = Math.round(ratio * 100);
  const color = ratio >= 0.8 ? TONE.err : ratio >= 0.5 ? TONE.warn : TONE.ok;
  const showTokens = cols >= CTX_TOKENS_MIN_COLS;
  const showBar = cols >= CTX_BAR_MIN_COLS;
  const filled = Math.round(CTX_BAR_CELLS * ratio);
  return (
    <>
      <Text color={FG.meta} wrap="truncate">{`${t("statusBar.ctx")} `}</Text>
      {showBar && (
        <>
          <Text color={color} wrap="truncate">
            {GLYPH.block.repeat(filled)}
          </Text>
          <Text color={FG.faint} wrap="truncate">
            {GLYPH.shade1.repeat(CTX_BAR_CELLS - filled)}
          </Text>
          <Text wrap="truncate"> </Text>
        </>
      )}
      <Text color={color} wrap="truncate">{`${pct}%`}</Text>
      {showTokens && (
        <Text color={FG.faint}>{` · ${formatTokens(tokens)}/${formatTokens(cap)}`}</Text>
      )}
      {ratio >= 0.8 && showTokens && (
        <Text color={TONE.err} wrap="truncate">{` · ${t("statusBar.ctxCompactHint")}`}</Text>
      )}
    </>
  );
}

function McpLoadingPill({
  ready,
  total,
}: {
  ready: number;
  total: number;
}): React.ReactElement {
  return (
    <>
      <Text color={TONE.brand} wrap="truncate">
        {"⌁ "}
      </Text>
      <Text color={FG.body}>{`${t("statusBar.mcpLoading")} ${ready}/${total}`}</Text>
    </>
  );
}

function WalletPill({
  balance,
  currency,
}: {
  balance?: number;
  currency?: string;
}): React.ReactElement {
  const balanceValue = balance ?? 0;
  return (
    <>
      <Text color={FG.meta} wrap="truncate">
        {"⛁ "}
      </Text>
      <Text bold color={balanceColor(balanceValue, currency)} wrap="truncate">
        {formatBalance(balanceValue, currency, { fractionDigits: 2 })}
      </Text>
      <Text color={FG.faint} wrap="truncate">
        {t("statusBar.left")}
      </Text>
    </>
  );
}

function ModePill({
  mode,
  network,
  detail,
}: {
  mode: Mode;
  network: NetworkState;
  detail?: string;
}): React.ReactElement {
  const modeLabel = `${t("statusBar.editsLabel")}${mode}`;
  if (network === "online") {
    const pill = modeGlyph(mode);
    return (
      <Box flexDirection="row" height={1} flexWrap="nowrap">
        <Text color={pill.color} wrap="truncate">
          {pill.glyph}
        </Text>
        <Text color={FG.sub} wrap="truncate">{` ${modeLabel}`}</Text>
      </Box>
    );
  }
  const dot = networkDot(network);
  if (network === "slow") {
    const tail = detail ? ` · ${detail}` : "";
    return (
      <Box flexDirection="row" height={1} flexWrap="nowrap">
        <Text color={dot.color} wrap="truncate">
          {dot.glyph}
        </Text>
        <Text color={dot.color}>{` ${modeLabel} · ${t("statusBar.slow")}${tail}`}</Text>
      </Box>
    );
  }
  if (network === "disconnected") {
    const tail = detail ? ` · ${detail}` : "";
    return (
      <Box flexDirection="row" height={1} flexWrap="nowrap">
        <Text color={dot.color} wrap="truncate">
          {dot.glyph}
        </Text>
        <Text color={dot.color} wrap="truncate">{` ${t("statusBar.disconnect")}${tail}`}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="row" height={1} flexWrap="nowrap">
      <Text color={dot.color} wrap="truncate">
        {dot.glyph}
      </Text>
      <Text color={dot.color} wrap="truncate">
        {` ${t("statusBar.reconnecting")}`}
      </Text>
    </Box>
  );
}

function CountdownRow({
  mode,
  secondsLeft,
}: {
  mode: Mode;
  secondsLeft: number;
}): React.ReactElement {
  const pill = modeGlyph(mode);
  const endsAt = Date.now() + secondsLeft * 1000;
  return (
    <Box flexDirection="row" height={1} flexWrap="nowrap">
      <Text color={pill.color} wrap="truncate">
        {pill.glyph}
      </Text>
      <Text color={FG.sub} wrap="truncate">
        {` ${t("statusBar.editsLabel")}${mode}   ·   `}
      </Text>
      <Text color={TONE.warn} wrap="truncate">
        {t("statusBar.approvingIn")}
      </Text>
      <Countdown endsAt={endsAt} />
      <Text color={TONE.warn} wrap="truncate">
        {t("statusBar.escToInterrupt")}
      </Text>
    </Box>
  );
}

function RecordingPill({ rec }: { rec: NonNullable<StatusBar["recording"]> }): React.ReactElement {
  const sizeMb = (rec.sizeBytes / (1024 * 1024)).toFixed(1);
  return (
    <Box flexDirection="row" height={1} flexWrap="nowrap">
      <Text bold color={TONE.err} wrap="truncate">
        {t("statusBar.recordingGlyph")}
      </Text>
      <Text
        color={TONE.err}
      >{` ${sizeMb}${t("statusBar.mb")} · ${rec.events}${t("statusBar.evt")}`}</Text>
    </Box>
  );
}

function Sep(): React.ReactElement {
  return (
    <Text color={FG.meta} wrap="truncate">
      {"   ·   "}
    </Text>
  );
}

function modeGlyph(mode: Mode): { glyph: string; color: string } {
  switch (mode) {
    case "auto":
      return { glyph: "●", color: TONE.ok };
    case "ask":
      return { glyph: "◐", color: TONE.warn };
    case "plan":
      return { glyph: "⊞", color: TONE.accent };
    case "edit":
      return { glyph: "±", color: TONE.ok };
  }
}

function networkDot(state: NetworkState): { glyph: string; color: string } {
  switch (state) {
    case "online":
      return { glyph: "●", color: TONE.ok };
    case "slow":
      return { glyph: "◌", color: TONE.warn };
    case "disconnected":
      return { glyph: "✗", color: TONE.err };
    case "reconnecting":
      return { glyph: "↻", color: TONE.brand };
  }
}

export type { StatusBar };
