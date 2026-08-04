import { Box, Text } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React, { useState } from "react";
import { type ModelProfileConfig, redactKey } from "../../config.js";
import {
  type OpenAIProviderSetup,
  configureOpenAIProvider,
} from "../../multi-agent/provider-setup.js";
import { suggestModelProfileId } from "../../providers/model-profiles.js";
import { MaskedInput } from "./MaskedInput.js";
import { useKeystroke } from "./keystroke-context.js";
import { COLOR, GLYPH } from "./theme.js";

export interface MultiAgentSetupProps {
  configured: boolean;
  configPath?: string;
  initialProfile?: ModelProfileConfig;
  onClose: () => void;
  onSaved: (message: string, profileId: string) => void;
}

type SetupStep = "profile" | "base-url" | "model" | "id" | "key";

const PROFILES = [
  {
    kind: "official" as const,
    title: "OpenAI 官方",
    detail: "api.openai.com · 使用内置 OpenAI 候选",
  },
  {
    kind: "relay" as const,
    title: "Responses 兼容中转站",
    detail: "自建或公司内部服务 · 自定义 Base URL 和模型",
  },
];

export function ModelProviderSetup({
  configured,
  configPath,
  initialProfile,
  onClose,
  onSaved,
}: MultiAgentSetupProps): React.ReactElement {
  const [step, setStep] = useState<SetupStep>("profile");
  const [focus, setFocus] = useState(0);
  const initialKind = initialProfile?.baseUrl ? "relay" : "official";
  const [profile, setProfile] = useState<OpenAIProviderSetup>(
    initialKind === "relay"
      ? {
          kind: "relay",
          baseUrl: initialProfile?.baseUrl ?? "",
          model: initialProfile?.model ?? "gpt-5.5",
          profileId: initialProfile?.id,
        }
      : {
          kind: "official",
          model: initialProfile?.model ?? "gpt-5.5",
          profileId: initialProfile?.id,
        },
  );
  const [baseUrl, setBaseUrl] = useState(initialProfile?.baseUrl ?? "");
  const [model, setModel] = useState(initialProfile?.model ?? "gpt-5.5");
  const [profileId, setProfileId] = useState(initialProfile?.id ?? "");
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeystroke((event) => {
    if (event.escape && !checking) {
      if (step === "profile") onClose();
      else {
        setError(null);
        setStep(
          step === "key" ? (initialProfile ? "model" : "id") : step === "id" ? "model" : "profile",
        );
      }
      return;
    }
    if (step !== "profile") return;
    if (event.upArrow) setFocus((current) => Math.max(0, current - 1));
    if (event.downArrow) setFocus((current) => Math.min(PROFILES.length - 1, current + 1));
    if (event.return) {
      const selected = PROFILES[focus];
      if (!selected) return;
      const nextProfile: OpenAIProviderSetup =
        selected.kind === "official"
          ? { kind: "official", model, profileId: initialProfile?.id }
          : { kind: "relay", baseUrl, model, profileId: initialProfile?.id };
      setProfile(nextProfile);
      setStep(selected.kind === "relay" ? "base-url" : "model");
    }
  });

  const submitKey = (raw: string) => {
    if (checking) return;
    setChecking(true);
    setError(null);
    const setup: OpenAIProviderSetup =
      profile.kind === "relay"
        ? { kind: "relay", baseUrl, model, profileId }
        : { kind: "official", model, profileId };
    void configureOpenAIProvider(raw, setup, { configPath })
      .then((result) => {
        setChecking(false);
        if (!result.ok) {
          setError(result.error);
          setKey("");
          return;
        }
        const relay = Boolean(result.baseUrl);
        const catalog =
          result.modelCount > 0 ? ` · ${result.modelCount} 个模型可见` : " · Responses 调用验证";
        const synced =
          result.syncedProfileIds.length > 0
            ? ` · 已同步 ${result.syncedProfileIds.join("、")}`
            : "";
        onSaved(
          relay
            ? `中转站已验证并保存为 ${result.profileId}（${result.model}${catalog}${synced}）。Key 已保存到用户凭据库。`
            : `OpenAI 模型档案 ${result.profileId} 已验证（${result.model}${catalog}）。Key 已保存到用户凭据库。`,
          result.profileId,
        );
        onClose();
      })
      .catch((setupError) => {
        setChecking(false);
        setKey("");
        setError(setupError instanceof Error ? setupError.message : String(setupError));
      });
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR.brand} paddingX={1}>
      <Text bold color={COLOR.brand}>
        {GLYPH.brand} Model Provider Setup
      </Text>

      {step === "profile" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>选择连接方式：</Text>
          {PROFILES.map((item, index) => (
            <Text key={item.kind} color={index === focus ? COLOR.primary : undefined}>
              {index === focus ? ">" : " "} {item.title} · {item.detail}
            </Text>
          ))}
          <Text dimColor>↑↓ 选择 · Enter 继续 · Esc 取消</Text>
        </Box>
      ) : null}

      {step === "base-url" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>中转站 Base URL：</Text>
          <Box>
            <Text color={COLOR.primary}>{"> "}</Text>
            <MaskedInput
              value={baseUrl}
              onChange={setBaseUrl}
              onSubmit={(raw) => {
                if (!raw.trim()) return setError("Base URL 不能为空。");
                setError(null);
                setBaseUrl(raw.trim());
                setProfile({
                  kind: "relay",
                  baseUrl: raw.trim(),
                  model,
                  profileId: initialProfile?.id,
                });
                setStep("model");
              }}
              mask=""
              placeholder="https://example.com/v1"
            />
          </Box>
          <Text dimColor>
            填写 API 根地址，不要追加 /responses。Carbon Code 直接连接，无需开启代理。
          </Text>
        </Box>
      ) : null}

      {step === "model" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>模型 ID：</Text>
          <Box>
            <Text color={COLOR.primary}>{"> "}</Text>
            <MaskedInput
              value={model}
              onChange={setModel}
              onSubmit={(raw) => {
                if (!raw.trim()) return setError("模型 ID 不能为空。");
                setError(null);
                setModel(raw.trim());
                const suggested = suggestModelProfileId("openai", raw.trim());
                if (!profileId) setProfileId(suggested);
                setProfile(
                  profile.kind === "relay"
                    ? {
                        kind: "relay",
                        baseUrl,
                        model: raw.trim(),
                        profileId: initialProfile?.id,
                      }
                    : {
                        kind: "official",
                        model: raw.trim(),
                        profileId: initialProfile?.id,
                      },
                );
                setStep(initialProfile ? "key" : "id");
              }}
              mask=""
              placeholder="gpt-5.5"
            />
          </Box>
          <Text dimColor>Backspace 可修改默认值 · Enter 继续 · Esc 返回</Text>
        </Box>
      ) : null}

      {step === "id" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>模型档案名称：</Text>
          <Box>
            <Text color={COLOR.primary}>{"> "}</Text>
            <MaskedInput
              value={profileId}
              onChange={setProfileId}
              onSubmit={(raw) => {
                const id = raw.trim();
                if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
                  return setError("名称只能包含字母、数字、点、下划线和连字符。");
                }
                setError(null);
                setProfileId(id);
                setStep("key");
              }}
              mask=""
              placeholder="openai-gpt-5-5"
            />
          </Box>
          <Text dimColor>该名称用于 /model 切换，也会被 multi-agent 直接复用。</Text>
        </Box>
      ) : null}

      {step === "key" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {profile.kind === "relay"
              ? `输入中转站 API Key（${baseUrl} · ${model}）`
              : configured
                ? "OpenAI Key 已配置；输入新 Key 可替换。"
                : "输入 OpenAI Platform API Key。"}
          </Text>
          <Text dimColor>
            Key 保存到 ~/.carboncode/credentials.json，不写入普通配置、会话历史或项目文件。
          </Text>
          <Box>
            <Text color={COLOR.primary}>{"> "}</Text>
            <MaskedInput
              value={key}
              onChange={checking ? () => undefined : setKey}
              onSubmit={submitKey}
              mask="*"
              placeholder={checking ? "正在验证..." : "sk-..."}
            />
          </Box>
          {key ? <Text dimColor>预览：{redactKey(key)}</Text> : null}
          <Text dimColor>
            Enter 验证 · Esc 返回 · 中转站缺少 /models 时会发起一次最小 Responses 调用
          </Text>
        </Box>
      ) : null}

      {error ? <Text color={COLOR.err}>{error}</Text> : null}
    </Box>
  );
}

/** Backward-compatible export for the original experimental entry point. */
export const MultiAgentSetup = ModelProviderSetup;
