import type { ProviderWireApi } from "./config.js";

export type ProviderProbeErrorCode =
  | "invalid_url"
  | "api_key_required"
  | "invalid_api_key"
  | "unauthorized"
  | "http_error"
  | "invalid_response"
  | "network_error";

export type ProviderProbeResult =
  | {
      ok: true;
      baseUrl: string;
      modelsEndpoint: string;
      models: string[];
      recommendedModel: string;
      providerName: string;
      wireApi: ProviderWireApi;
    }
  | {
      ok: false;
      baseUrl: string;
      code: ProviderProbeErrorCode;
      message: string;
      httpStatus?: number;
    };

const TERMINAL_PATH_SUFFIXES = ["/chat/completions", "/responses", "/models"] as const;
const NON_AGENT_MODEL_MARKERS = [
  "embedding",
  "embed-",
  "-embed",
  "moderation",
  "rerank",
  "whisper",
  "transcri",
  "text-to-speech",
  "speech-",
  "tts",
  "realtime",
  "auto-review",
  "audio",
  "image",
  "dall-e",
  "sora",
] as const;

export function normalizeProviderApiKey(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();
}

export function providerApiKeyValidationError(value: string): string | null {
  if (!value) return "An API key is required.";
  if (/[^\x21-\x7E]/.test(value)) {
    return "The API key contains whitespace or non-ASCII characters. Paste only the provider key (for example, sk-...).";
  }
  return null;
}

export function normalizeProviderBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    let path = url.pathname.replace(/\/+$/, "");
    for (const suffix of TERMINAL_PATH_SUFFIXES) {
      if (path.toLowerCase().endsWith(suffix)) {
        path = path.slice(0, -suffix.length).replace(/\/+$/, "");
        break;
      }
    }
    url.pathname = path || "/";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function modelCatalogCandidates(baseUrl: string): Array<{ apiBaseUrl: string; endpoint: string }> {
  const candidates: Array<{ apiBaseUrl: string; endpoint: string }> = [];
  const add = (apiBaseUrl: string) => {
    const normalized = apiBaseUrl.replace(/\/+$/, "");
    const endpoint = `${normalized}/models`;
    if (!candidates.some((candidate) => candidate.endpoint === endpoint)) {
      candidates.push({ apiBaseUrl: normalized, endpoint });
    }
  };
  add(baseUrl);
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.toLowerCase().endsWith("/v1")) {
    url.pathname = path.slice(0, -3) || "/";
    add(url.toString().replace(/\/+$/, ""));
  } else {
    add(`${baseUrl}/v1`);
  }
  return candidates;
}

function providerNameFromUrl(baseUrl: string): string {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host === "api.openai.com") return "OpenAI";
  if (host === "api.deepseek.com") return "DeepSeek";
  const visible = host.replace(/^api\./, "").replace(/^www\./, "");
  return visible || "OpenAI compatible";
}

export function isLikelyAgentModel(model: string): boolean {
  const lower = model.toLowerCase();
  return !NON_AGENT_MODEL_MARKERS.some((marker) => lower.includes(marker));
}

function modelScore(model: string): number {
  const lower = model.toLowerCase();
  if (!isLikelyAgentModel(model)) return -10_000;
  let score = 1_000;
  if (/^(gpt|o\d|codex|deepseek|claude|qwen|gemini|glm|mistral)/.test(lower)) score += 100;
  if (/(chat|instruct|reasoner|coder|code)/.test(lower)) score += 30;
  if (/(preview|experimental|exp|beta|canary)/.test(lower)) score -= 80;
  if (/(mini|nano|flash|lite)/.test(lower)) score -= 20;
  if (/\d(?:\.\d+)+$/.test(lower) || /(?:chat|reasoner|coder)$/.test(lower)) score += 200;
  else if (/\d(?:\.\d+)+-[a-z]/.test(lower)) score -= 40;
  const versions = [...lower.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (versions.length) score += Math.min(50, versions.at(-1) ?? 0);
  return score;
}

export function recommendProviderModel(models: readonly string[]): string {
  return (
    [...models].sort(
      (a, b) => modelScore(b) - modelScore(a) || b.localeCompare(a, undefined, { numeric: true }),
    )[0] ?? ""
  );
}

export function inferWireApiForModel(model: string): Exclude<ProviderWireApi, "auto"> {
  const lower = model.trim().toLowerCase();
  if (/^(gpt-5(?:[.-]|$)|o[1-9](?:[.-]|$)|codex(?:[.-]|$))/.test(lower)) return "responses";
  return "chat_completions";
}

function parseModelIds(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  return [
    ...new Set(
      data
        .map((item) =>
          item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
            ? (item as { id: string }).id.trim()
            : "",
        )
        .filter(Boolean),
    ),
  ]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, 500);
}

export async function probeOpenAICompatibleProvider(input: {
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): Promise<ProviderProbeResult> {
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      baseUrl: input.baseUrl.trim(),
      code: "invalid_url",
      message: "Enter a valid HTTP(S) API base URL.",
    };
  }

  const apiKey = normalizeProviderApiKey(input.apiKey);
  if (!apiKey) {
    return {
      ok: false,
      baseUrl,
      code: "api_key_required",
      message: "An API key is required to read the provider model catalog.",
    };
  }
  const apiKeyError = providerApiKeyValidationError(apiKey);
  if (apiKeyError) {
    return {
      ok: false,
      baseUrl,
      code: "invalid_api_key",
      message: apiKeyError,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 15_000);
  const fetchFn = input.fetch ?? globalThis.fetch.bind(globalThis);
  let lastStatus: number | undefined;
  let sawInvalidResponse = false;
  try {
    for (const candidate of modelCatalogCandidates(baseUrl)) {
      let response: Response;
      try {
        response = await fetchFn(candidate.endpoint, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          signal: ctrl.signal,
        });
      } catch (error) {
        if (ctrl.signal.aborted) throw error;
        continue;
      }
      lastStatus = response.status;
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          baseUrl: candidate.apiBaseUrl,
          code: "unauthorized",
          message: "The provider rejected this API key.",
          httpStatus: response.status,
        };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 404 || response.status === 405) continue;
        return {
          ok: false,
          baseUrl: candidate.apiBaseUrl,
          code: "http_error",
          message: `The provider model catalog returned HTTP ${response.status}.`,
          httpStatus: response.status,
        };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        sawInvalidResponse = true;
        continue;
      }
      const models = parseModelIds(payload);
      if (!models?.length) {
        sawInvalidResponse = true;
        continue;
      }
      const agentModels = models.filter(isLikelyAgentModel);
      if (!agentModels.length) {
        sawInvalidResponse = true;
        continue;
      }
      const recommendedModel = recommendProviderModel(agentModels);
      return {
        ok: true,
        baseUrl: candidate.apiBaseUrl,
        modelsEndpoint: candidate.endpoint,
        models: agentModels,
        recommendedModel,
        providerName: providerNameFromUrl(candidate.apiBaseUrl),
        wireApi: inferWireApiForModel(recommendedModel),
      };
    }

    return sawInvalidResponse
      ? {
          ok: false,
          baseUrl,
          code: "invalid_response",
          message: "The provider did not return a non-empty OpenAI-compatible model catalog.",
        }
      : {
          ok: false,
          baseUrl,
          code: "http_error",
          message: `No compatible model catalog endpoint was found${lastStatus ? ` (HTTP ${lastStatus})` : ""}.`,
          httpStatus: lastStatus,
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      baseUrl,
      code: "network_error",
      message: message || "Unable to reach the provider model catalog.",
    };
  } finally {
    clearTimeout(timer);
  }
}
