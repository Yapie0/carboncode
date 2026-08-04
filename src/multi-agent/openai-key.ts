import { isPlausibleKey } from "../config.js";
import { OpenAIResponsesClient } from "../providers/openai-responses.js";

export type OpenAIKeySetupResult =
  | { ok: true; modelCount: number; modelIds: string[] }
  | { ok: false; error: string };

/** Validate first, then expose the key to this Carbon Code process only. */
export async function setOpenAIKeyForSession(
  raw: string,
  options: {
    fetch?: typeof fetch;
    baseUrl?: string;
    envName?: string;
    /** Some Codex-style relays omit /models; use one minimal Responses call as fallback. */
    validationModel?: string;
  } = {},
): Promise<OpenAIKeySetupResult> {
  const apiKey = raw.trim();
  if (!isPlausibleKey(apiKey)) {
    return { ok: false, error: "Key 格式无效：至少 16 个字符，且不能包含空格。" };
  }
  const client = new OpenAIResponsesClient({
    apiKey,
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    retry: { maxAttempts: 1 },
  });
  const models = await client.listModels({ signal: AbortSignal.timeout(15_000) });
  if (!models && options.validationModel) {
    try {
      await client.chat({
        model: options.validationModel,
        messages: [{ role: "user", content: "Reply with OK." }],
        maxTokens: 1,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { ok: false, error: "OpenAI 验证失败，请检查 Key、Base URL、模型或网络配置。" };
    }
  } else if (!models) {
    return { ok: false, error: "OpenAI 验证失败，请检查 Key、网络或代理配置。" };
  }
  process.env[options.envName ?? "OPENAI_API_KEY"] = apiKey;
  const modelIds =
    models?.data
      .map((model) => model.id.trim())
      .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index) ?? [];
  return { ok: true, modelCount: modelIds.length, modelIds };
}
