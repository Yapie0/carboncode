import { resolveThemePreference, saveTheme } from "@/config.js";
import { t } from "@/i18n/index.js";
import { type ThemeName, isThemeName, listThemeNames } from "../../theme/tokens.js";
import type { SlashHandler } from "../dispatch.js";

const themeChoices = ["auto", ...listThemeNames()] as const;

function isThemeChoice(value: string): value is ThemeName | "auto" {
  return value === "auto" || isThemeName(value);
}

const theme: SlashHandler = (args) => {
  const next = args[0];
  if (!next) return { openThemePicker: true };

  if (!isThemeChoice(next)) {
    return {
      info: t("handlers.theme.unknownTheme", {
        theme: next,
        available: themeChoices.join(", "),
      }),
    };
  }

  saveTheme(next);
  const active = resolveThemePreference(next, process.env.REASONIX_THEME);
  return { info: t("handlers.theme.saved", { theme: next, active }) };
};

export const handlers: Record<string, SlashHandler> = {
  theme,
};
