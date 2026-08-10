# Provider and model compatibility matrix

Date: 2026-08-07

## Scope

This report records live provider verification for Carbon Code CLI `0.2.13` and
the Windows desktop release candidate `0.43.17`. Credentials came from the
locally saved provider configuration and were never written to reports or test
output.

The source-level matrix checked every Agent-capable model with four independent
requests:

1. Non-streaming text completion.
2. Streaming text completion.
3. Native function tool call.
4. Tool-result continuation.

The packaged-runtime matrix then extracted the final portable ZIP and drove its
actual `node.exe + dist/cli/index.js desktop` JSONL protocol. A model passed only
when the runtime restored the requested model, emitted the expected content,
and completed the turn without an error event.

## Passing Agent models

| Provider | Model | Source protocol | Staged portable | Final ZIP |
| --- | --- | --- | --- | --- |
| DeepSeek | `deepseek-v4-flash` | 4/4 | Pass | Pass |
| DeepSeek | `deepseek-v4-pro` | 4/4 | Pass | Pass |
| Sea | `gpt-5.3-codex-spark` | 4/4 | Pass | Pass |
| Sea | `gpt-5.4` | 4/4 | Pass | Pass |
| Sea | `gpt-5.4-2026-03-05` | 4/4 | Pass | Pass |
| Sea | `gpt-5.4-mini` | 4/4 | Pass | Pass |
| Sea | `gpt-5.5` | 4/4 | Pass | Pass |
| Sea | `gpt-5.6-sol` | 4/4 | Pass | Pass |
| Sea | `gpt-5.6-terra` | 4/4 | Pass | Pass |

The final extracted ZIP result was **9 passed, 0 failed**. A separate visible
desktop GUI run using `gpt-5.5` also created a real session, streamed reasoning
and answer text, and completed multiple `read_file` tool calls while the window
remained responsive.

## Provider-side failures

The following catalog entries consistently returned HTTP `503 Service
temporarily unavailable` from the Sea provider on both attempted API routes.
They are not reported as Carbon Code passes:

- `gpt-5.2`
- `gpt-5.2-2025-12-11`
- `gpt-5.2-chat-latest`
- `gpt-5.2-pro`
- `gpt-5.2-pro-2025-12-11`

`gpt-5.6-luna` is currently provider-flaky. Repeated valid Requests API calls
alternated between success, a stalled stream, and an HTTP 200 response with an
empty `output` array during tool continuation. Carbon Code now retries a truly
empty semantic response up to three total attempts, but Luna is intentionally
excluded from the stable release matrix until the provider route is reliable.

## Non-Agent catalog entries

The Agent picker now excludes routes whose advertised purpose cannot support a
normal coding-agent conversation:

- `codex-auto-review`
- `gpt-4o-audio-preview`
- `gpt-4o-realtime-preview`
- `gpt-image-1`
- `gpt-image-1.5`
- `gpt-image-2`

These entries remain provider catalog data; they are not presented as usable
chat Agent models.

## Resilience behavior

- Empty Responses API results are retried with bounded 250 ms and 500 ms
  backoff, for three attempts in total.
- Streaming retries occur only before any text, reasoning, or tool delta has
  been emitted. This prevents duplicate visible output and duplicate tool side
  effects.
- A permanently empty response fails explicitly after the third attempt.
- Audio, realtime, image, embedding, reranking, moderation, and auto-review
  routes are filtered from the Agent selector.

## Automated verification

- CLI full verification: pass.
- Desktop JavaScript tests: 46 total, 41 pass, 5 platform skips, 0 fail.
- Desktop production frontend build: pass.
- Windows native build: pass.
- Final portable ZIP matrix: 9 pass, 0 fail.
- Visible packaged desktop GUI request: pass.

Reusable commands:

```powershell
npm run verify:provider-matrix
npm run verify:portable-matrix
```

## Raw reports

- [DeepSeek Flash source matrix](../../reports/provider-model-matrix-deepseek-flash-source-20260807.json)
- [DeepSeek Pro source matrix](../../reports/provider-model-matrix-deepseek-pro-source-20260807.json)
- [Sea source matrix](../../reports/provider-model-matrix-sea-source-after-fix-20260807.json)
- [Luna debug run](../../reports/provider-model-matrix-luna-debug-20260807.json)
- [Luna retry run](../../reports/provider-model-matrix-luna-retry-1-20260807.json)
- [Staged portable matrix](../../reports/provider-model-matrix-portable-v0.43.17-20260807.json)
- [Final extracted ZIP matrix](../../reports/provider-model-matrix-portable-final-zip-v0.43.17-20260807.json)

