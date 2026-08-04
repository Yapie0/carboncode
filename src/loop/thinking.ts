import { type ThinkingPreference, resolveThinkingPreference } from "../models.js";

/** True when the model emits reasoning_content and requires it round-tripped on follow-ups. */
export function isThinkingModeModel(
  model: string,
  preference: ThinkingPreference = "auto",
): boolean {
  return resolveThinkingPreference(model, preference) === "enabled";
}

/** Resolves raw HTTP `thinking.type`; unknown providers stay untouched in auto mode. */
export function thinkingModeForModel(
  model: string,
  preference: ThinkingPreference = "auto",
): "enabled" | "disabled" | undefined {
  return resolveThinkingPreference(model, preference);
}

// Natural-language "think harder" trigger (Claude-style): when the user asks to think
// deeply, the loop escalates that turn to the pro model (reasoning effort is already max).
const DEEP_THINK_RE =
  /\bultra[\s-]?think\b|\bthink\s+(?:hard(?:er)?|deeply|step\s+by\s+step|this\s+through|carefully)\b|\breason\s+carefully\b|深入思考|深度思考|仔细想想|好好想想|认真想想|深思熟虑/i;

export function wantsDeepThinking(text: string): boolean {
  return DEEP_THINK_RE.test(text);
}

/** Strip hallucinated tool-call envelopes — `tools: undefined` doesn't always force prose. */
export function stripHallucinatedToolMarkup(s: string): string {
  let out = s;
  // DeepSeek's DSML envelope (full-width "｜" is the form R1 emits in practice).
  out = out.replace(/<｜DSML｜function_calls>[\s\S]*?<\/?｜DSML｜function_calls>/g, "");
  out = out.replace(/<\|DSML\|function_calls>[\s\S]*?<\/?\|DSML\|function_calls>/g, "");
  out = out.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "");
  // Lone unpaired DSML opener left over after R1 truncates mid-call.
  out = out.replace(/<｜DSML｜[\s\S]*$/g, "");
  return out.trim();
}
