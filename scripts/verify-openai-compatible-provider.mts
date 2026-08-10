import { DeepSeekClient } from "../src/client.js";
import { probeOpenAICompatibleProvider } from "../src/provider-probe.js";
import type { ChatMessage, ToolSpec } from "../src/types.js";

const baseUrl = process.env.CARBONCODE_PROVIDER_BASE_URL?.trim() ?? "";
const apiKey = process.env.CARBONCODE_PROVIDER_API_KEY?.trim() ?? "";
const requestedModel = process.env.CARBONCODE_PROVIDER_MODEL?.trim() ?? "";

if (!baseUrl || !apiKey) {
  throw new Error(
    "Set CARBONCODE_PROVIDER_BASE_URL and CARBONCODE_PROVIDER_API_KEY before running this verifier.",
  );
}

const probe = await probeOpenAICompatibleProvider({ baseUrl, apiKey });
if (!probe.ok) {
  throw new Error(`Provider discovery failed (${probe.code}): ${probe.message}`);
}
const model = requestedModel || probe.recommendedModel;
if (!probe.models.includes(model)) {
  throw new Error(`Requested model ${JSON.stringify(model)} was not returned by the provider catalog.`);
}

const client = new DeepSeekClient({
  apiKey,
  baseUrl: probe.baseUrl,
  providerName: probe.providerName,
  wireApi: "auto",
  reasoningEffortMax: "auto",
  maxTools: null,
  sendThinking: false,
  retry: { maxAttempts: 1 },
});

const direct = await client.chat({
  model,
  messages: [
    { role: "system", content: "Follow the user's exact output instruction." },
    { role: "user", content: "Reply with exactly COMPAT_OK and nothing else." },
  ],
  reasoningEffort: "max",
  maxTokens: 512,
});
if (!direct.content.includes("COMPAT_OK")) {
  throw new Error("The non-streaming compatibility request returned no expected text.");
}

let streamedText = "";
for await (const chunk of client.stream({
  model,
  messages: [{ role: "user", content: "Reply with exactly STREAM_OK and nothing else." }],
  reasoningEffort: "max",
  maxTokens: 512,
})) {
  streamedText += chunk.contentDelta ?? "";
}
if (!streamedText.includes("STREAM_OK")) {
  throw new Error("The streaming compatibility request returned no expected text.");
}

const echoTool: ToolSpec = {
  type: "function",
  function: {
    name: "compatibility_echo",
    description: "Return a verification value unchanged.",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};
const first = await client.chat({
  model,
  messages: [
    {
      role: "user",
      content:
        "Call compatibility_echo exactly once with value TOOL_OK. Do not answer directly before the tool call.",
    },
  ],
  tools: [echoTool],
  reasoningEffort: "max",
  maxTokens: 768,
});
const call = first.toolCalls.find((item) => item.function.name === "compatibility_echo");
if (!call?.id) throw new Error("The provider did not return the required function call.");
const args = JSON.parse(call.function.arguments) as { value?: unknown };
if (args.value !== "TOOL_OK") throw new Error("The provider returned incorrect function arguments.");

const continuation: ChatMessage[] = [
  {
    role: "user",
    content:
      "Call compatibility_echo exactly once with value TOOL_OK. Do not answer directly before the tool call.",
  },
  {
    role: "assistant",
    content: first.content,
    tool_calls: first.toolCalls,
    provider_items: first.providerItems,
  },
  { role: "tool", tool_call_id: call.id, content: "TOOL_OK" },
];
const completed = await client.chat({
  model,
  messages: continuation,
  tools: [echoTool],
  reasoningEffort: "max",
  maxTokens: 768,
});
if (!completed.content.trim()) {
  throw new Error("The provider did not complete the turn after receiving the tool result.");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    provider: probe.providerName,
    apiBaseUrl: probe.baseUrl,
    models: probe.models.length,
    model,
    inferredWireApi: probe.wireApi,
    checks: ["catalog", "non_stream", "stream", "tool_call", "tool_continuation"],
  })}\n`,
);
