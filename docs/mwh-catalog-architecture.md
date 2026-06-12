# Middlewave Hub Catalog Architecture

## Scope

Middlewave Hub (MWH) is a reusable implementation reference library, not a
cloud product directory. A module should help an agent implement one concrete
middleware capability in a target codebase.

The built-in catalog is expanding from `video-call-webrtc` into a verified
capability library. This document defines how to expand MWH without turning it
into an unverified list of links.

## Classification

Use capability categories instead of vendor product categories:

- `async-jobs`: background jobs, queues, scheduled jobs, retry workers.
- `eventing`: transactional outbox, inbox/idempotent consumers, Kafka/RabbitMQ adapters.
- `api-traffic`: rate limiting, idempotency keys, API gateway-style request guards.
- `auth-security`: JWT/session auth, RBAC, OAuth PKCE state, password reset tokens, webhook signature verification.
- `realtime`: WebSocket/Socket.IO chat, presence, notifications, collaborative channels.
- `storage-transfer`: uploads, presigned URLs, multipart upload, object-store adapters.
- `cache-state`: Redis cache, stale-while-revalidate, single-flight cache, distributed locks, counters.
- `data-access`: database connection pools, query adapters, transactions, read/write splitting, repository units of work, change data capture.
- `observability`: OpenTelemetry tracing, metrics, structured logging, audit trails.
- `feature-config`: feature flags, remote config, rollout rules.
- `notification`: email adapters, in-app, push, webhook delivery.
- `service-governance`: service registry, discovery, health checks, traffic policy, bulkhead isolation, load shedding.
- `ai-infra`: vector search adapters, model gateways, embedding cache retrieval, prompt template registries, token budget managers, agent task dispatch.

Cloud middleware products such as Alibaba Cloud MSE, Tencent TDMQ, or Huawei
CSE can be source references, but MWH modules should stay implementation-led:
adapter contract, failure modes, tests, and integration steps.

## Candidate Source Survey

These are candidates found during initial GitHub research. They are not
admitted into MWH until the validation gate passes.

| Capability | Candidate module id | Implementation variants | Reference sources |
| --- | --- | --- | --- |
| Background jobs | `job-queue-bullmq` | BullMQ worker/queue, sandbox worker, dashboard via bull-board | `taskforcesh/bullmq`, `taskforcesh/bullmq-typescript`, `felixmosh/bull-board` |
| Recurring jobs | `cron-scheduler` | memory scheduler, SQL row-lock scheduler, Redis sorted-set scheduler, BullMQ repeatable jobs | cron scheduling patterns, BullMQ repeatable jobs, SQL/Redis scheduler patterns |
| Delayed job queues | `delayed-job-queue` | delay calculation, retry/backoff, visibility leases, dead-letter handoff, memory/Redis/SQL adapters | delayed queue patterns, retry scheduling, visibility timeout queues |
| Rate limiting | `rate-limit-http` | Express basic limiter, Redis-backed flexible limiter, sliding-window Redis limiter | `express-rate-limit/express-rate-limit`, `animir/node-rate-limiter-flexible`, `spinlud/redis-sliding-rate-limiter`, `stacksjs/ts-rate-limiter` |
| Circuit breakers | `circuit-breaker` | closed/open/half-open state transitions, rolling failures, cooldown probes, memory/Redis adapters | circuit breaker pattern, service resilience, gateway failure isolation |
| Request timeout budgets | `request-timeout-budget` | deadline headers, remaining budget, child-call caps, timeout expiry, AbortController adapters | gRPC deadline propagation, HTTP client timeout patterns, distributed deadline budgets |
| Request retry policies | `request-retry-policy` | retryable failure classification, Retry-After, exponential backoff, deadline cutoff, fetch/axios/RPC adapters | HTTP retry/backoff patterns, Retry-After semantics, gRPC retry/deadline patterns |
| Request body guards | `request-body-guard` | body size limits, content-type allowlists, JSON depth/field limits, route policy registry | API gateway body limits, Express/Fastify parser limits, OWASP input size controls |
| Request header policies | `request-header-policy` | required headers, allowed/blocked names, spoofed internal header protection, per-header and total byte limits | API gateway header validation, HTTP 431 behavior, trusted proxy spoofing hardening |
| CORS policy | `cors-policy` | route-scoped origin/method/header allowlists, preflight responses, credential-safe policy registry, Express/Fastify/gateway adapters | browser CORS semantics, Express/Fastify/Hono CORS middleware, API gateway CORS policy patterns |
| CSRF token guard | `csrf-token-guard` | HMAC signed session-bound CSRF tokens, token hashing, one-time consume, TTL expiry, Redis/SQL/session adapters | synchronizer token patterns, signed double-submit token patterns, SameSite cookie CSRF guidance |
| Transactional eventing | `transactional-outbox` | NestJS inbox/outbox module, Prisma + Kafka relay, CDC/outbox | `Nestixis/nestjs-inbox-outbox`, `suites/transactional-outbox`, GitHub `outbox-pattern` topic |
| Event bus adapters | `event-bus-adapter` | normalized envelope, topic binding, subscription filtering, Kafka/Pulsar/NATS/EventBridge adapters | Kafka/EventBridge/Pulsar event envelope mapping, topic routing patterns |
| In-memory pub/sub | `in-memory-pubsub` | topic subscriptions, deterministic publish fan-out, unsubscribe lifecycle, message audit | local event bus patterns, pub/sub contract tests, adapter-independent eventing |
| Idempotent consuming | `idempotent-consumer` | processed-message table, Redis duplicate lock, broker ack/nack wrapper | idempotent consumer pattern, transactional inbox pattern, dead-letter queue handling |
| Dead-letter queues | `dead-letter-queue` | failure classification, replay leases, release/resolve/archive lifecycle, SQL/Redis/broker adapters | Kafka/RabbitMQ/SQS DLQ patterns, poison-message handling, operational replay tooling |
| API idempotency | `idempotency-key` | Express/Node request cache, Hono middleware, Lambda/Middy idempotency | `mahendraHegde/node-idempotency`, `stacks0x/idempotix`, `paveg/hono-problem-details`, `ibrahimcesar/middy-idempotent` |
| Auth | `auth-jwt-refresh` | JWT validation middleware, access/refresh token service, RBAC middleware | `auth0/express-jwt`, `dax-side/jwt-abstraction`, `Louis3797/express-ts-auth-service` |
| API key auth | `api-key-auth` | hashed API keys, prefix lookup, scopes, revocation, rotation | API key bearer credential patterns, timing-safe comparison, scoped credential rotation |
| RBAC policy | `rbac-policy` | role binding, permission matching, wildcard/resource checks, memory/SQL policy stores | RBAC authorization patterns, scoped permission checks, policy evaluation tests |
| Webhook auth | `webhook-signature-verify` | timestamped HMAC verification, nonce replay store, Redis/SQL adapters | Stripe/GitHub/Slack-style webhook signing, Redis SET NX EX replay protection |
| Session stores | `session-store` | server-side session TTL, sliding touch, absolute expiry, per-session and subject-wide revocation, Redis/SQL adapters | Redis/SQL session store patterns, sliding expiry, subject-wide session revocation |
| Session token rotation | `session-token-rotation` | access/refresh token pair lifecycle, rotation families, replay detection, revoke-all semantics | refresh-token rotation patterns, session family revocation, replay protection |
| OAuth PKCE state | `oauth-pkce-state` | S256 code challenges, state records, redirect callback validation, one-time consume, Redis/SQL/session adapters | OAuth authorization code with PKCE, OAuth state CSRF protection, Redis SET NX EX state storage |
| OTP code verifier | `otp-code-verifier` | hashed one-time verification codes, TTL, resend cooldown, attempt lockout, consume/revoke lifecycle, Redis/SQL/delivery adapters | OTP login/MFA patterns, OWASP authentication guidance, Redis TTL one-time code storage |
| Password reset tokens | `password-reset-token` | hashed one-time reset tokens, expiry, attempt lockout, consume/revoke lifecycle, Redis/SQL/email adapters | account recovery token patterns, OWASP forgot password guidance, Redis TTL one-time token storage |
| Database connection pools | `database-connection-pool` | acquire/release lifecycle, bounded max size, wait queue, idle/lifetime expiry, health snapshots, SQL/Postgres/MySQL adapters | node-postgres Pool, mysql2 pool, PgBouncer/ProxySQL operations, generic bounded-resource pools |
| Transaction scopes | `transaction-scope` | begin/commit/rollback lifecycle, savepoints, timeout expiry, unit-of-work wrapper, pg/mysql/ORM adapters | PostgreSQL SAVEPOINT, MySQL transaction lifecycle, repository unit-of-work patterns |
| Read/write splitting | `read-write-splitter` | query intent routing, primary/replica selection, replica lag filtering, fresh-read fallback, pool adapter mapping | primary/replica SQL routing, ProxySQL/PgBouncer patterns, read-your-writes consistency patterns |
| Query result cache | `query-result-cache` | stable query keys, TTL/stale windows, dependency tags, write invalidation, Redis/SQL adapters | repository query caching, Redis tag invalidation, stale-while-revalidate patterns |
| Repository unit of work | `repository-unit-of-work` | repository operation staging, apply/commit gates, rollback compensation, ORM/SQL/outbox adapters | Unit of Work pattern, repository transactions, Prisma/TypeORM/Knex transaction wrappers |
| Change data capture | `change-data-capture` | ordered row changes, envelopes, consumer cursors, batch reads, ack progression, SQL/Debezium adapters | CDC patterns, Debezium envelopes, Postgres logical replication, MySQL binlog, polling checkpoints |
| SQL polling CDC | `sql-polling-cdc-adapter` | safe polling SQL plans, row-to-CDC mapping, sequence checkpoints, memory adapter, SQL checkpoint table adapters | polling-based CDC, trigger change tables, SQL keyset polling, durable checkpoint patterns |
| Cursor pagination | `cursor-pagination` | keyset pagination, opaque cursors, stable sort tie-breaker, next/previous page windows, SQL tuple predicates | GraphQL Relay cursors, SQL keyset pagination, search_after patterns |
| Schema migration runner | `schema-migration-runner` | ordered migration plans, checksum validation, lease locks, fencing tokens, applied/failed records, SQL adapters | Flyway/Liquibase/Prisma/Knex migration table patterns, advisory locks |
| Webhooks | `webhook-delivery` | endpoint retry policy, HTTP result classification, retry schedule, DLQ, delivery attempts | `madebyankur/wbhks`, `VaibhavXBhardwaj/webhook-delivery-engine`, `posthook/posthook-node`, Stripe/GitHub redelivery patterns |
| Webhook dispatcher | `webhook-dispatcher` | subscription matching, event fan-out, signing policy, delivery enqueue plan, audit records | webhook fan-out services, provider signing policies, transactional outbox to delivery queue patterns |
| Realtime chat | `realtime-chat-socketio` | Socket.IO rooms, presence, typing/read receipts, per-user routing | `Aaromalpm/quick-socket`, `rodhfr/chatwav`, Socket.IO chat repos |
| Realtime chat channels | `realtime-chat-channel` | member roles, message validation, deterministic fan-out, history paging, read receipts, WebSocket/SSE/file adapters | Socket.IO room patterns, WebSocket chat fan-out, Redis pub/sub plus SQL history |
| Object key policies | `object-key-policy` | tenant-scoped key normalization, traversal rejection, extension/content-type policy, upload/download authorization | S3-compatible key prefix isolation, multi-tenant bucket patterns, direct-upload security patterns |
| Object uploads | `object-upload-presigned` | provider-neutral upload middleware, S3 multipart presigned URL flow, range reads | `th3hero/express-storage`, `prestonlimlianjie/aws-s3-multipart-presigned-upload`, `kalisio/feathers-s3` |
| Chunked download cache | `chunked-download-cache` | byte-range cache metadata, partial segment reuse, ETag/Last-Modified validation, origin revalidation plans | HTTP range request caching, CDN byte-range cache behavior, resumable download patterns |
| Multipart upload sessions | `multipart-upload-session` | provider-neutral session ledger, part checksum/size validation, completion payload, abort/expiry, SQL/Redis/object-store adapters | S3/R2/OSS multipart ledgers, TUS-style session state, object-store completion payload rules |
| Resumable uploads | `resumable-upload-manifest` | chunk manifest, checksum validation, missing chunk detection, merge plan, filesystem/SQL/Redis adapters | TUS-style resumable upload manifests, HTTP chunked upload patterns, checksum validation |
| Sliding counters | `sliding-window-counter` | memory buckets, Redis hash/zset counters, SQL bucket table | sliding-window rate limiting, Redis counter patterns, time-bucket aggregation |
| Cache-aside | `cache-aside` | read-through helper, stale fallback, TTL policy, invalidation hooks, memory/Redis adapter contracts | cache-aside pattern, stale-on-error serving, Redis TTL invalidation patterns |
| Distributed lock | `distributed-lock` | lease acquire/renew/release, fencing tokens, contention wait policy, Redis/SQL adapter boundaries | Redis SET NX PX locks, fencing-token lock patterns, database advisory locks |
| Single-flight cache | `single-flight-cache` | TTL cache entries, miss coalescing, work leases, concurrent loader sharing, Redis/SQL adapters | Go singleflight pattern, Redis SET NX PX leases, cache stampede protection patterns |
| Observability | `otel-express-node` | SDK bootstrap, Express/HTTP instrumentation, metrics/log correlation | OpenTelemetry JS repositories, `microsoft/opentelemetry-distro-javascript` |
| Request trace context | `request-trace-context` | trace/span propagation, request correlation IDs, baggage filtering, async-local context adapter | W3C Trace Context, OpenTelemetry context propagation, request ID middleware patterns |
| Audit trails | `audit-log-trail` | append-only audit entries, metadata redaction, hash-chain verification, SQL/object archive adapters | audit-log hash-chain patterns, SIEM export, immutable archive retention |
| Structured log redaction | `structured-log-redactor` | sensitive field/path/pattern filtering, stable JSON, clone-safe log sink, stdout/OTel/SIEM adapters | Pino/Winston redaction patterns, OpenTelemetry log safety, security logging guidance |
| HTTP metrics | `http-metrics-recorder` | route/status aggregation, latency percentiles, Prometheus/OTel adapters | Prometheus HTTP metrics conventions, OpenTelemetry Metrics semantic conventions, RED metrics |
| Feature flags | `feature-flags-provider` | provider-neutral SDK, Next/SvelteKit flags, open-source control plane | `vercel/flags`, `featurehub-io/featurehub-javascript-sdk`, `Unleash/unleash-mcp` |
| Feature flag rollout | `feature-flag-rollout` | stable bucketing, percentage rollout, targeting rules, variant assignment, memory/provider adapters | deterministic hashing, gradual rollout policies, Unleash/LaunchDarkly-style targeting |
| Config schema validation | `config-schema-validator` | schema records, defaults, required fields, enum/range/pattern checks, publish gates, AJV/Zod/SQL adapters | JSON Schema validation, AJV/Zod runtime validation, remote config publish workflows |
| Remote config | `remote-config-store` | environment/tenant rules, snapshots, ETags, version history, rollback | remote configuration service patterns, Consul/etcd KV config, ETag polling |
| Service registry | `service-registry` | registration, heartbeat, TTL expiry, health filtering, snapshots, endpoint selection, Redis/SQL/provider adapters | Consul/Nacos/etcd discovery, Kubernetes EndpointSlice, Eureka lease heartbeat patterns |
| Health checks | `health-check-orchestrator` | probe definitions, due scheduling, observations, failure thresholds, target aggregation, HTTP/TCP/provider adapters | Kubernetes probes, Consul/Nacos health checks, circuit-breaker failure threshold patterns |
| Traffic policy | `traffic-policy-router` | weighted routing, canary rules, attribute matching, health filtering, sticky hash selection, gateway/client adapters | Envoy weighted clusters, APISIX/Kong route matching, Kubernetes traffic splitting, client-side load balancing |
| Bulkhead isolation | `bulkhead-isolation` | per-scope concurrency limits, bounded queues, queue timeouts, release promotion, Redis/SQL/worker-pool adapters | Bulkhead isolation pattern, semaphore queues, Redis leases, API gateway concurrency limiting |
| Load shedding | `load-shedder` | fixed-window budgets, priority-aware admission, overload drops, retry-after hints, Redis/gateway adapters | Overload protection, priority admission, fixed/sliding-window counters, API gateway load shedding |
| Notifications | `notification-hub` | multi-channel workflow service, email queue, websocket push | `novuhq/novu`, `gotify/server`, `productdevbook/unemail`, `impruthvi/nodemail` |
| Notification routing | `notification-router` | preference routing, quiet hours, dedupe windows, channel adapters | multi-channel notification service patterns, Redis SET NX EX dedupe, durable notification outbox |
| Email delivery | `email-delivery-adapter` | template rendering, recipient normalization, provider response classification, retry/dead-letter outbox, SES/SendGrid/SMTP adapters | transactional email outbox patterns, SES/SendGrid/Resend/Mailgun/SMTP adapters, exponential backoff delivery queues |
| SMS delivery | `sms-delivery-adapter` | E.164 normalization, SMS segment estimation, provider response classification, retry/dead-letter outbox, Twilio/Vonage/SNS adapters | transactional SMS outbox patterns, E.164 phone normalization, GSM-7/UCS-2 segment estimation, exponential backoff delivery queues |
| Push delivery | `push-delivery-adapter` | APNs/FCM/Web push targets, payload normalization, collapse keys, TTL expiry, retry/dead-letter outbox | APNs/FCM/Web Push adapter boundaries, device token invalidation, collapse-key and TTL semantics |
| In-app notifications | `in-app-notification-store` | user-scoped inbox records, unread counts, cursor paging, read/archive transitions, TTL expiry, SQL/Redis adapters | in-app notification center patterns, cursor-paged inboxes, unread-count models, realtime inbox updates |
| Model gateway | `model-gateway` | provider routing, cost estimation, retry decisions, usage audit | LLM gateway/router patterns, provider fallback, token cost accounting |
| Prompt template registry | `prompt-template-registry` | variable extraction, versioned templates, published rendering, render audit, SQL/Git/remote config adapters | prompt registry/versioning patterns, LLMOps audit workflows, remote config lifecycle |
| Token budget manager | `token-budget-manager` | context-window policy, reserved output tokens, priority fragment packing, dropped context reporting, usage audit, tokenizer adapters | LLM context budgeting, RAG context packing, tokenizer adapters, prompt usage audit workflows |
| Embedding cache retrieval | `embedding-cache-retrieval` | normalized embedding requests, cache keying, provider fallback, retrieval result caching, invalidation hooks | embedding cache patterns, RAG retrieval caches, vector-store hydration workflows |
| Vector search adapter | `vector-search-adapter` | provider-neutral vector documents, cosine/dot/euclidean scoring, metadata filters, topK search, memory index | pgvector, Qdrant, Milvus, Chroma, Redis Vector, Elasticsearch vector retrieval patterns |
| Agent task dispatch | `agent-task-dispatcher` | capability-based routing, agent status, max concurrency, assignment lifecycle, memory dispatcher, SQL/Redis/file-collab adapters | multi-agent worker routing, distributed leases, SQL SKIP LOCKED, Redis heartbeat coordination |
| Agent collaboration mailbox | `agent-collab-mailbox` | message envelopes, inbox/outbox audit, read acknowledgements, task threads, permission_request flow, memory mailbox, JSONL/MCP adapters | file-based inbox/outbox protocols, JSONL audit logs, MCP mailbox tools, local multi-agent collaboration |
| Realtime presence | `presence-channel` | in-memory presence, Redis/Postgres presence store, Socket.IO or file-collab adapter | Socket.IO rooms, Redis presence patterns, WebSocket heartbeat patterns |

## Proposed Repository Layout

Keep the public install shape unchanged:

```text
.carboncode/
  mwh/
    modules/
      <module-id>/
        manifest.json
        MWH.md
```

Change the built-in source organization from one large inline string to files:

```text
src/mwh/
  builtin.ts
  catalog.ts
  modules/
    realtime/
      video-call-webrtc/
        manifest.template.json
        MWH.md
        verification.md
    async-jobs/
      job-queue-bullmq/
        manifest.template.json
        MWH.md
        verification.md
    api-traffic/
      rate-limit-http/
        manifest.template.json
        MWH.md
        verification.md
```

`catalog.ts` should load or import module descriptors and expose the same
`MwhModule[]` used by `listMwhModules()`.

## Module Document Contract

Every `MWH.md` should follow this shape:

```text
# MWH Module: <title>

## Purpose
## When To Use
## When Not To Use
## Implementation Variants
## Recommended Architecture
## Public API Sketch
## Integration Steps
## Failure Modes
## Security Notes
## Verification Checklist
## Source References
```

Multiple implementations of the same capability live in one module when the
decision is mostly adapter choice. Example:

- `rate-limit-http`
  - variant A: in-memory fixed window for local/dev.
  - variant B: Redis sliding window for distributed deployments.
  - variant C: token bucket for burst-friendly APIs.

Split into separate modules only when the integration model is materially
different. Example: `job-queue-bullmq` and `transactional-outbox` should stay
separate even though both may publish async work.

## Verification Gate

Do not add a module to `BUILTIN_MWH_MODULES` until it passes:

1. Source audit
   - License is compatible with reference use.
   - Upstream is active enough or the implementation is small enough to own.
   - At least two independent references exist for common failure modes.
2. Minimal local reproduction
   - A small fixture or example can run in CI without external cloud services.
   - External dependencies run through Docker or in-memory fakes when possible.
3. Tests
   - Unit tests cover pure logic and adapter contracts.
   - Integration tests cover the primary happy path and one failure path.
   - Security-sensitive modules include negative tests.
4. MWH integrity
   - `MWH.md` has source references and a concrete verification checklist.
   - `manifest.json` hash check passes.
   - `/mwh search`, `/mwh show`, `/mwh install`, and MCP read/list tools see it.

## Admission Status

| Module | Status | Next validation |
| --- | --- | --- |
| `video-call-webrtc` | admitted | Keep Playwright two-tab call checklist as future E2E fixture |
| `presence-channel` | admitted | Add Redis/Postgres adapter fixtures after storage abstraction lands |
| `realtime-chat-channel` | admitted | Add Socket.IO transport and SQL history adapter fixtures |
| `job-queue-bullmq` | admitted | Add Redis-backed BullMQ adapter fixture with Queue, Worker, retry, and dead-letter checks |
| `cron-scheduler` | admitted | Add SQL row-lock and Redis sorted-set adapter fixtures |
| `delayed-job-queue` | admitted | Add Redis zset and SQL due-time claim fixtures with retry/backoff and DLQ handoff |
| `rate-limit-http` | candidate | Compare in-memory, Redis fixed/sliding window behavior with deterministic tests |
| `circuit-breaker` | admitted | Add Redis shared-state adapter and HTTP client/gateway fallback fixtures |
| `request-timeout-budget` | admitted | Add Express/Fastify middleware and AbortController adapter fixtures |
| `request-retry-policy` | admitted | Add fetch/axios adapter fixtures and timeout-budget integration tests |
| `request-body-guard` | admitted | Add Express/Fastify streaming body limit adapter fixtures |
| `request-header-policy` | admitted | Add Express/Fastify/Fetch adapters and gateway config rendering tests |
| `cors-policy` | admitted | Add Express/Fastify/Hono middleware fixtures and gateway policy export tests |
| `csrf-token-guard` | admitted | Add Redis/SQL atomic consume fixtures and Express/Fastify form/header middleware tests |
| `transactional-outbox` | candidate | SQLite/Postgres fixture: write entity + outbox in one transaction, relay once |
| `event-bus-adapter` | admitted | Add Kafka/EventBridge adapter mapping fixtures |
| `in-memory-pubsub` | admitted | Add topic wildcard and unsubscribe regression fixtures |
| `idempotent-consumer` | admitted | Add SQL processed-message table and Redis lock adapter fixtures |
| `dead-letter-queue` | admitted | Add SQL atomic replay claim fixture and broker DLQ import/export adapters |
| `idempotency-key` | candidate | Duplicate POST returns cached response; mismatched fingerprint rejects |
| `auth-jwt-refresh` | admitted | Add jose/RS256 adapter and HTTP cookie middleware fixture |
| `api-key-auth` | admitted | Add SQL credential table and HTTP middleware adapter fixtures |
| `rbac-policy` | admitted | Add SQL policy store and framework route-guard fixtures |
| `webhook-signature-verify` | admitted | Add Redis SET NX EX and framework raw-body adapter fixtures |
| `session-store` | admitted | Add Redis TTL/subject-index adapter and SQL session table fixtures |
| `session-token-rotation` | admitted | Add SQL token-family store and replay-detection fixtures |
| `oauth-pkce-state` | admitted | Add Redis/SQL atomic consume fixtures and provider token-exchange integration tests |
| `otp-code-verifier` | admitted | Add Redis/SQL atomic attempt fixtures and email/SMS delivery integration tests |
| `password-reset-token` | admitted | Add Redis/SQL one-time consume fixtures and email delivery integration tests |
| `database-connection-pool` | admitted | Add pg/mysql adapter fixtures and transaction wrapper tests |
| `transaction-scope` | admitted | Add pg/mysql adapter fixtures and withTransaction integration tests |
| `read-write-splitter` | admitted | Add pg/mysql pool adapter fixtures and read-your-writes integration tests |
| `query-result-cache` | admitted | Add Redis tag-index adapter fixture and repository wrapper tests |
| `repository-unit-of-work` | admitted | Add Prisma/TypeORM adapter fixtures and transactional-outbox post-commit integration test |
| `change-data-capture` | admitted | Add SQL polling adapter and query-result-cache invalidation fixture |
| `sql-polling-cdc-adapter` | admitted | Add real SQL adapter fixture with checkpoint table and cache invalidation integration |
| `cursor-pagination` | admitted | Add SQL tuple predicate adapter and API response contract tests |
| `schema-migration-runner` | admitted | Add SQL migration table and advisory lock adapter fixtures |
| `webhook-delivery` | admitted | Add SQL attempt table and HTTP adapter fixtures |
| `webhook-dispatcher` | admitted | Add subscription store fixture and transactional-outbox enqueue integration test |
| `object-key-policy` | admitted | Add SQL/config tenant policy adapters and presigned-upload integration fixture |
| `object-upload-presigned` | candidate | Local MinIO or fake S3: init multipart, part URLs, complete, abort |
| `chunked-download-cache` | admitted | Add filesystem/Redis segment cache fixture with ETag revalidation |
| `multipart-upload-session` | admitted | Add SQL ledger adapter and S3/R2 completion/abort fixtures |
| `resumable-upload-manifest` | admitted | Add filesystem temp-chunk and SQL manifest adapter fixtures |
| `sliding-window-counter` | admitted | Add Redis hash/zset adapter fixtures with atomic increments |
| `cache-aside` | admitted | Add Redis cache adapter and stale-on-error repository wrapper fixture |
| `distributed-lock` | admitted | Add Redis fencing-token adapter and SQL advisory-lock fixture |
| `single-flight-cache` | admitted | Add Redis lease/cache adapter and HTTP middleware scoped-key fixture |
| `http-metrics-recorder` | admitted | Add Prometheus and OpenTelemetry adapter fixtures |
| `otel-express-node` | admitted | Add Express adapter and OpenTelemetry SDK/OTLP fixture |
| `request-trace-context` | admitted | Add W3C traceparent propagation and async-local context fixtures |
| `audit-log-trail` | admitted | Add SQL append-only table and immutable archive fixture |
| `structured-log-redactor` | admitted | Add Pino/Winston/OTel adapter fixtures and secret-leak regression corpus |
| `feature-flags-provider` | candidate | Add provider SDK wrapper fixtures and remote-config-backed local provider |
| `feature-flag-rollout` | admitted | Add deterministic bucketing fixture and provider adapter parity tests |
| `config-schema-validator` | admitted | Add AJV/Zod adapter parity tests and remote-config update integration fixture |
| `remote-config-store` | admitted | Add SQL version table and Redis snapshot cache fixtures |
| `health-check-orchestrator` | admitted | Add HTTP/TCP probe adapters and service-registry status propagation fixture |
| `service-registry` | admitted | Add Redis/SQL/provider adapter fixtures with lease cleanup and concurrent heartbeat tests |
| `traffic-policy-router` | admitted | Add gateway config rendering and service-registry endpoint mapping fixtures |
| `bulkhead-isolation` | admitted | Add Redis semaphore adapter and HTTP middleware release-on-error fixture |
| `load-shedder` | admitted | Add Redis sliding-window adapter and HTTP retry-after response fixture |
| `notification-hub` | admitted | Add SQL delivery log and provider adapter fixtures |
| `notification-router` | admitted | Add SQL preference store and Redis dedupe adapter fixtures |
| `email-delivery-adapter` | admitted | Add SES/SendGrid/SMTP provider fakes and SQL outbox worker-claim fixture |
| `sms-delivery-adapter` | admitted | Add Twilio/Vonage/SNS provider fakes and SQL outbox worker-claim fixture |
| `push-delivery-adapter` | admitted | Add APNs/FCM/Web Push provider fakes and device-token registry cleanup fixture |
| `in-app-notification-store` | admitted | Add SQL inbox table fixture and realtime unread-count update tests |
| `model-gateway` | admitted | Add provider adapter and SQL usage audit fixtures |
| `prompt-template-registry` | admitted | Add SQL/Git-backed registry fixtures and model-gateway render integration tests |
| `token-budget-manager` | admitted | Add tokenizer adapter fixtures and prompt-template/vector-search/model-gateway integration tests |
| `embedding-cache-retrieval` | admitted | Add embedding provider cache fixture and vector-search hydration integration tests |
| `vector-search-adapter` | admitted | Add pgvector and Qdrant adapter fixtures plus permission-filter regression tests |
| `agent-task-dispatcher` | admitted | Add SQL/Redis lease fixtures and .carboncode/collab inbox/outbox adapter tests |
| `agent-collab-mailbox` | admitted | Add JSONL file adapter with atomic append and MCP mailbox CRUD tests |

## First Batch Recommendation

The first non-video MWH batch should be small and high-leverage:

1. `rate-limit-http`
2. `job-queue-bullmq`
3. `transactional-outbox`
4. `idempotency-key`
5. `object-upload-presigned`

These cover the most common reusable backend middleware needs and can be
validated locally without paid cloud services.
