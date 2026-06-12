import { AGENT_COLLAB_MAILBOX_MODULE } from "./modules/ai-infra/agent-collab-mailbox.js";
import { AGENT_TASK_DISPATCHER_MODULE } from "./modules/ai-infra/agent-task-dispatcher.js";
import { EMBEDDING_CACHE_RETRIEVAL_MODULE } from "./modules/ai-infra/embedding-cache-retrieval.js";
import { MODEL_GATEWAY_MODULE } from "./modules/ai-infra/model-gateway.js";
import { PROMPT_TEMPLATE_REGISTRY_MODULE } from "./modules/ai-infra/prompt-template-registry.js";
import { TOKEN_BUDGET_MANAGER_MODULE } from "./modules/ai-infra/token-budget-manager.js";
import { VECTOR_SEARCH_ADAPTER_MODULE } from "./modules/ai-infra/vector-search-adapter.js";
import { CIRCUIT_BREAKER_MODULE } from "./modules/api-traffic/circuit-breaker.js";
import { CORS_POLICY_MODULE } from "./modules/api-traffic/cors-policy.js";
import { CSRF_TOKEN_GUARD_MODULE } from "./modules/api-traffic/csrf-token-guard.js";
import { IDEMPOTENCY_KEY_MODULE } from "./modules/api-traffic/idempotency-key.js";
import { RATE_LIMIT_HTTP_MODULE } from "./modules/api-traffic/rate-limit-http.js";
import { REQUEST_BODY_GUARD_MODULE } from "./modules/api-traffic/request-body-guard.js";
import { REQUEST_HEADER_POLICY_MODULE } from "./modules/api-traffic/request-header-policy.js";
import { REQUEST_RETRY_POLICY_MODULE } from "./modules/api-traffic/request-retry-policy.js";
import { REQUEST_TIMEOUT_BUDGET_MODULE } from "./modules/api-traffic/request-timeout-budget.js";
import { CRON_SCHEDULER_MODULE } from "./modules/async-jobs/cron-scheduler.js";
import { DELAYED_JOB_QUEUE_MODULE } from "./modules/async-jobs/delayed-job-queue.js";
import { JOB_QUEUE_BULLMQ_MODULE } from "./modules/async-jobs/job-queue-bullmq.js";
import { API_KEY_AUTH_MODULE } from "./modules/auth-security/api-key-auth.js";
import { AUTH_JWT_REFRESH_MODULE } from "./modules/auth-security/auth-jwt-refresh.js";
import { OAUTH_PKCE_STATE_MODULE } from "./modules/auth-security/oauth-pkce-state.js";
import { OTP_CODE_VERIFIER_MODULE } from "./modules/auth-security/otp-code-verifier.js";
import { PASSWORD_RESET_TOKEN_MODULE } from "./modules/auth-security/password-reset-token.js";
import { RBAC_POLICY_MODULE } from "./modules/auth-security/rbac-policy.js";
import { SESSION_TOKEN_ROTATION_MODULE } from "./modules/auth-security/session-token-rotation.js";
import { WEBHOOK_SIGNATURE_VERIFY_MODULE } from "./modules/auth-security/webhook-signature-verify.js";
import { CACHE_ASIDE_MODULE } from "./modules/cache-state/cache-aside.js";
import { DISTRIBUTED_LOCK_MODULE } from "./modules/cache-state/distributed-lock.js";
import { SESSION_STORE_MODULE } from "./modules/cache-state/session-store.js";
import { SINGLE_FLIGHT_CACHE_MODULE } from "./modules/cache-state/single-flight-cache.js";
import { SLIDING_WINDOW_COUNTER_MODULE } from "./modules/cache-state/sliding-window-counter.js";
import { CHANGE_DATA_CAPTURE_MODULE } from "./modules/data-access/change-data-capture.js";
import { CURSOR_PAGINATION_MODULE } from "./modules/data-access/cursor-pagination.js";
import { DATABASE_CONNECTION_POOL_MODULE } from "./modules/data-access/database-connection-pool.js";
import { QUERY_RESULT_CACHE_MODULE } from "./modules/data-access/query-result-cache.js";
import { READ_WRITE_SPLITTER_MODULE } from "./modules/data-access/read-write-splitter.js";
import { REPOSITORY_UNIT_OF_WORK_MODULE } from "./modules/data-access/repository-unit-of-work.js";
import { SCHEMA_MIGRATION_RUNNER_MODULE } from "./modules/data-access/schema-migration-runner.js";
import { SQL_POLLING_CDC_ADAPTER_MODULE } from "./modules/data-access/sql-polling-cdc-adapter.js";
import { TRANSACTION_SCOPE_MODULE } from "./modules/data-access/transaction-scope.js";
import { DEAD_LETTER_QUEUE_MODULE } from "./modules/eventing/dead-letter-queue.js";
import { EVENT_BUS_ADAPTER_MODULE } from "./modules/eventing/event-bus-adapter.js";
import { IDEMPOTENT_CONSUMER_MODULE } from "./modules/eventing/idempotent-consumer.js";
import { IN_MEMORY_PUBSUB_MODULE } from "./modules/eventing/in-memory-pubsub.js";
import { TRANSACTIONAL_OUTBOX_MODULE } from "./modules/eventing/transactional-outbox.js";
import { CONFIG_SCHEMA_VALIDATOR_MODULE } from "./modules/feature-config/config-schema-validator.js";
import { FEATURE_FLAG_ROLLOUT_MODULE } from "./modules/feature-config/feature-flag-rollout.js";
import { REMOTE_CONFIG_STORE_MODULE } from "./modules/feature-config/remote-config-store.js";
import { EMAIL_DELIVERY_ADAPTER_MODULE } from "./modules/notification/email-delivery-adapter.js";
import { IN_APP_NOTIFICATION_STORE_MODULE } from "./modules/notification/in-app-notification-store.js";
import { NOTIFICATION_HUB_MODULE } from "./modules/notification/notification-hub.js";
import { NOTIFICATION_ROUTER_MODULE } from "./modules/notification/notification-router.js";
import { PUSH_DELIVERY_ADAPTER_MODULE } from "./modules/notification/push-delivery-adapter.js";
import { SMS_DELIVERY_ADAPTER_MODULE } from "./modules/notification/sms-delivery-adapter.js";
import { WEBHOOK_DELIVERY_MODULE } from "./modules/notification/webhook-delivery.js";
import { WEBHOOK_DISPATCHER_MODULE } from "./modules/notification/webhook-dispatcher.js";
import { AUDIT_LOG_TRAIL_MODULE } from "./modules/observability/audit-log-trail.js";
import { HTTP_METRICS_RECORDER_MODULE } from "./modules/observability/http-metrics-recorder.js";
import { OTEL_EXPRESS_NODE_MODULE } from "./modules/observability/otel-express-node.js";
import { REQUEST_TRACE_CONTEXT_MODULE } from "./modules/observability/request-trace-context.js";
import { STRUCTURED_LOG_REDACTOR_MODULE } from "./modules/observability/structured-log-redactor.js";
import { PRESENCE_CHANNEL_MODULE } from "./modules/realtime/presence-channel.js";
import { REALTIME_CHAT_CHANNEL_MODULE } from "./modules/realtime/realtime-chat-channel.js";
import { VIDEO_CALL_WEBRTC_MODULE } from "./modules/realtime/video-call-webrtc.js";
import { BULKHEAD_ISOLATION_MODULE } from "./modules/service-governance/bulkhead-isolation.js";
import { GITHUB_OPS_GUARD_MODULE } from "./modules/service-governance/github-ops-guard.js";
import { HEALTH_CHECK_ORCHESTRATOR_MODULE } from "./modules/service-governance/health-check-orchestrator.js";
import { LOAD_SHEDDER_MODULE } from "./modules/service-governance/load-shedder.js";
import { SERVICE_REGISTRY_MODULE } from "./modules/service-governance/service-registry.js";
import { TRAFFIC_POLICY_ROUTER_MODULE } from "./modules/service-governance/traffic-policy-router.js";
import { CHUNKED_DOWNLOAD_CACHE_MODULE } from "./modules/storage-transfer/chunked-download-cache.js";
import { MULTIPART_UPLOAD_SESSION_MODULE } from "./modules/storage-transfer/multipart-upload-session.js";
import { OBJECT_KEY_POLICY_MODULE } from "./modules/storage-transfer/object-key-policy.js";
import { OBJECT_UPLOAD_PRESIGNED_MODULE } from "./modules/storage-transfer/object-upload-presigned.js";
import { RESUMABLE_UPLOAD_MANIFEST_MODULE } from "./modules/storage-transfer/resumable-upload-manifest.js";
import type { MwhModule } from "./types.js";

export const BUILTIN_MWH_MODULES: readonly MwhModule[] = Object.freeze([
  AGENT_COLLAB_MAILBOX_MODULE,
  AGENT_TASK_DISPATCHER_MODULE,
  EMBEDDING_CACHE_RETRIEVAL_MODULE,
  MODEL_GATEWAY_MODULE,
  PROMPT_TEMPLATE_REGISTRY_MODULE,
  TOKEN_BUDGET_MANAGER_MODULE,
  VECTOR_SEARCH_ADAPTER_MODULE,
  CIRCUIT_BREAKER_MODULE,
  CORS_POLICY_MODULE,
  CSRF_TOKEN_GUARD_MODULE,
  IDEMPOTENCY_KEY_MODULE,
  RATE_LIMIT_HTTP_MODULE,
  REQUEST_BODY_GUARD_MODULE,
  REQUEST_HEADER_POLICY_MODULE,
  REQUEST_RETRY_POLICY_MODULE,
  REQUEST_TIMEOUT_BUDGET_MODULE,
  CRON_SCHEDULER_MODULE,
  DELAYED_JOB_QUEUE_MODULE,
  JOB_QUEUE_BULLMQ_MODULE,
  API_KEY_AUTH_MODULE,
  AUTH_JWT_REFRESH_MODULE,
  OAUTH_PKCE_STATE_MODULE,
  OTP_CODE_VERIFIER_MODULE,
  PASSWORD_RESET_TOKEN_MODULE,
  RBAC_POLICY_MODULE,
  SESSION_TOKEN_ROTATION_MODULE,
  WEBHOOK_SIGNATURE_VERIFY_MODULE,
  CACHE_ASIDE_MODULE,
  DISTRIBUTED_LOCK_MODULE,
  SESSION_STORE_MODULE,
  SINGLE_FLIGHT_CACHE_MODULE,
  SLIDING_WINDOW_COUNTER_MODULE,
  CHANGE_DATA_CAPTURE_MODULE,
  CURSOR_PAGINATION_MODULE,
  DATABASE_CONNECTION_POOL_MODULE,
  QUERY_RESULT_CACHE_MODULE,
  READ_WRITE_SPLITTER_MODULE,
  REPOSITORY_UNIT_OF_WORK_MODULE,
  SCHEMA_MIGRATION_RUNNER_MODULE,
  SQL_POLLING_CDC_ADAPTER_MODULE,
  TRANSACTION_SCOPE_MODULE,
  DEAD_LETTER_QUEUE_MODULE,
  EVENT_BUS_ADAPTER_MODULE,
  IDEMPOTENT_CONSUMER_MODULE,
  IN_MEMORY_PUBSUB_MODULE,
  TRANSACTIONAL_OUTBOX_MODULE,
  CONFIG_SCHEMA_VALIDATOR_MODULE,
  FEATURE_FLAG_ROLLOUT_MODULE,
  REMOTE_CONFIG_STORE_MODULE,
  EMAIL_DELIVERY_ADAPTER_MODULE,
  IN_APP_NOTIFICATION_STORE_MODULE,
  NOTIFICATION_HUB_MODULE,
  NOTIFICATION_ROUTER_MODULE,
  PUSH_DELIVERY_ADAPTER_MODULE,
  SMS_DELIVERY_ADAPTER_MODULE,
  WEBHOOK_DELIVERY_MODULE,
  WEBHOOK_DISPATCHER_MODULE,
  AUDIT_LOG_TRAIL_MODULE,
  HTTP_METRICS_RECORDER_MODULE,
  OTEL_EXPRESS_NODE_MODULE,
  REQUEST_TRACE_CONTEXT_MODULE,
  STRUCTURED_LOG_REDACTOR_MODULE,
  PRESENCE_CHANNEL_MODULE,
  REALTIME_CHAT_CHANNEL_MODULE,
  VIDEO_CALL_WEBRTC_MODULE,
  BULKHEAD_ISOLATION_MODULE,
  GITHUB_OPS_GUARD_MODULE,
  HEALTH_CHECK_ORCHESTRATOR_MODULE,
  LOAD_SHEDDER_MODULE,
  SERVICE_REGISTRY_MODULE,
  TRAFFIC_POLICY_ROUTER_MODULE,
  CHUNKED_DOWNLOAD_CACHE_MODULE,
  MULTIPART_UPLOAD_SESSION_MODULE,
  OBJECT_KEY_POLICY_MODULE,
  OBJECT_UPLOAD_PRESIGNED_MODULE,
  RESUMABLE_UPLOAD_MANIFEST_MODULE,
]);
