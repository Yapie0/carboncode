import { saveMaxOutputTokens, saveModel, savePreset, saveThinkingMode } from "@/config.js";
import { t } from "@/i18n/index.js";
import { thinkingModeForModel } from "@/loop.js";
import {
  ESCALATION_MODEL_ID,
  FLASH_MODEL_ID,
  PRO_MODEL_ID,
  migrateRetiredModel,
} from "@/models.js";
import { PRESETS } from "../../presets.js";
import type { SlashHandler } from "../dispatch.js";

function inferPresetFromModel(id: string): "auto" | "flash" | "pro" | null {
  if (id === PRO_MODEL_ID) return "pro";
  if (id === FLASH_MODEL_ID) return "flash";
  return null;
}

const model: SlashHandler = (args, loop, ctx) => {
  const id = args[0];
  const known = ctx.models ?? null;
  if (!id) {
    return { openModelPicker: true };
  }
  // Manual model pick = explicit pin: disable auto-escalate so flash doesn't
  // get bumped, and persist the inferred preset so a relaunch keeps the choice.
  const migration = migrateRetiredModel(id);
  loop.configure({ model: id, autoEscalate: false });
  const activeId = loop.model;
  ctx.dispatch?.({ type: "session.model.change", model: activeId });
  const inferred = migration.migrated ? null : inferPresetFromModel(activeId);
  ctx.dispatch?.({ type: "session.preset.change", preset: inferred });
  if (inferred) {
    try {
      savePreset(inferred);
    } catch {
      /* disk full / perms — runtime change still took effect */
    }
  } else {
    try {
      saveModel(migration.migrated ? id : activeId);
    } catch {
      /* disk full / perms — runtime change still took effect */
    }
  }
  if (known && known.length > 0 && !known.includes(activeId)) {
    return {
      info: t("handlers.model.modelNotInCatalog", { id: activeId, list: known.join(", ") }),
    };
  }
  return { info: t("handlers.model.modelSet", { id: activeId }) };
};

const preset: SlashHandler = (args, loop, ctx) => {
  const name = (args[0] ?? "").toLowerCase();
  const apply = (
    presetName: "auto" | "flash" | "pro",
    p: (typeof PRESETS)[keyof typeof PRESETS],
  ) => {
    loop.configure({
      model: p.model,
      autoEscalate: p.autoEscalate,
      reasoningEffort: p.reasoningEffort,
    });
    ctx.dispatch?.({ type: "session.model.change", model: p.model });
    ctx.dispatch?.({ type: "session.preset.change", preset: presetName });
    try {
      savePreset(presetName);
    } catch {
      /* disk full / perms — runtime change still took effect */
    }
  };
  if (name === "auto") {
    apply("auto", PRESETS.auto);
    return { info: t("handlers.model.presetAuto") };
  }
  if (name === "flash") {
    apply("flash", PRESETS.flash);
    return { info: t("handlers.model.presetFlash") };
  }
  if (name === "pro") {
    apply("pro", PRESETS.pro);
    return { info: t("handlers.model.presetPro") };
  }
  if (name === "") {
    return { openModelPicker: true };
  }
  return { info: t("handlers.model.presetUsage") };
};

const thinking: SlashHandler = (args, loop) => {
  const value = (args[0] ?? "").toLowerCase();
  if (!value) {
    return {
      info: t("handlers.model.thinkingStatus", {
        mode: loop.thinkingMode,
        effective: thinkingModeForModel(loop.model, loop.thinkingMode) ?? "provider-default",
      }),
    };
  }
  const mode =
    value === "on" || value === "enabled"
      ? "enabled"
      : value === "off" || value === "disabled"
        ? "disabled"
        : value === "auto"
          ? "auto"
          : null;
  if (!mode) return { info: t("handlers.model.thinkingUsage") };
  loop.configure({ thinkingMode: mode });
  try {
    saveThinkingMode(mode);
  } catch {
    // The live mode remains active even when config persistence fails.
  }
  return {
    info: t("handlers.model.thinkingSet", {
      mode,
      effective: thinkingModeForModel(loop.model, mode) ?? "provider-default",
    }),
  };
};

const maxOutput: SlashHandler = (args, loop) => {
  const value = (args[0] ?? "").toLowerCase();
  if (!value) {
    return {
      info: t("handlers.model.maxOutputStatus", {
        tokens: loop.maxOutputTokens?.toLocaleString() ?? "provider-default",
      }),
    };
  }
  if (value === "off" || value === "default") {
    loop.configure({ maxOutputTokens: null });
    try {
      saveMaxOutputTokens(undefined);
    } catch {
      // The live setting remains active even when config persistence fails.
    }
    return { info: t("handlers.model.maxOutputOff") };
  }
  const tokens = Number(value.replaceAll(",", ""));
  if (!Number.isInteger(tokens) || tokens <= 0) {
    return { info: t("handlers.model.maxOutputUsage") };
  }
  loop.configure({ maxOutputTokens: tokens });
  try {
    saveMaxOutputTokens(tokens);
  } catch {
    // The live setting remains active even when config persistence fails.
  }
  return {
    info: t("handlers.model.maxOutputSet", {
      tokens: tokens.toLocaleString(),
    }),
  };
};

const pro: SlashHandler = (args, loop, ctx) => {
  const arg = (args[0] ?? "").toLowerCase();
  if (arg === "off" || arg === "cancel" || arg === "disarm") {
    if (!loop.proArmed) {
      return { info: t("handlers.model.proNothingArmed") };
    }
    if (ctx.disarmPro) ctx.disarmPro();
    else loop.disarmPro();
    return { info: t("handlers.model.proDisarmed") };
  }
  if (arg && arg !== "on" && arg !== "arm") {
    return { info: t("handlers.model.proUsage") };
  }
  if (ctx.armPro) ctx.armPro();
  else loop.armProForNextTurn();
  return {
    info: t("handlers.model.proArmed", { model: ESCALATION_MODEL_ID }),
  };
};

const budget: SlashHandler = (args, loop) => {
  const arg = args[0]?.trim() ?? "";
  if (arg === "") {
    if (loop.budgetUsd === null) {
      return { info: t("handlers.model.budgetNoCap") };
    }
    const spent = loop.stats.totalCost;
    const pct = (spent / loop.budgetUsd) * 100;
    return {
      info: t("handlers.model.budgetStatus", {
        spent: spent.toFixed(4),
        cap: loop.budgetUsd.toFixed(2),
        pct: pct.toFixed(1),
      }),
    };
  }
  if (arg === "off" || arg === "none" || arg === "0") {
    loop.setBudget(null);
    return { info: t("handlers.model.budgetOff") };
  }
  const cleaned = arg.replace(/^\$/, "");
  const usd = Number(cleaned);
  if (!Number.isFinite(usd) || usd <= 0) {
    return { info: t("handlers.model.budgetUsage", { arg }) };
  }
  loop.setBudget(usd);
  const spent = loop.stats.totalCost;
  if (spent >= usd) {
    return {
      info: t("handlers.model.budgetExhausted", {
        cap: usd.toFixed(2),
        spent: spent.toFixed(4),
      }),
    };
  }
  return {
    info: t("handlers.model.budgetSet", {
      cap: usd.toFixed(2),
      spent: spent.toFixed(4),
    }),
  };
};

export const handlers: Record<string, SlashHandler> = {
  model,
  preset,
  thinking,
  "max-output": maxOutput,
  pro,
  budget,
};
