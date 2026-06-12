import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: OAuth PKCE State

## Purpose

Use this module as a reusable reference for OAuth authorization-code login with PKCE: create state records, derive S256 code challenges, verify redirect callbacks, enforce redirect_uri/state matching, consume states exactly once, and prune expired entries.

The module focuses on the local state/PKCE layer. Provider-specific token exchange remains in an adapter so the state handling can be reused across GitHub, Google, Microsoft, internal SSO, or mobile deep-link flows.

## When To Use

- Need OAuth login with authorization code + PKCE.
- Need one-time state values to protect against CSRF and replay.
- Need deterministic tests before adding Redis, SQL, or session-backed state storage.
- Need to validate redirect_uri consistency across start and callback.

## When Not To Use

- Do not store OAuth state only in process memory for production.
- Do not accept callbacks with missing state or missing code.
- Do not reuse state values after a successful callback.
- Do not exchange provider tokens before state and redirect_uri verification succeeds.

## Implementation Variants

- Memory store for tests and local prototypes.
- Redis state store with SET NX EX and one-time consume.
- SQL state table with consumed/expired status.
- Encrypted cookie state for low-infrastructure deployments.
- Provider adapter for token exchange after local verification.

## Recommended Architecture

- core.ts: pure PKCE code challenge, state record creation, redirect verification, consume/fail transitions, and clone helpers.
- memory-store.ts: stateful start, verify, consume, fail, pruneExpired, get, and list behavior.
- adapters/redis.ts: atomic create and consume using SET NX and Lua/transactions.
- adapters/sql.ts: durable state rows and callback audit.
- integrations/session.ts: bind OAuth state metadata to session or tenant context.

## Public API Sketch

\`\`\`ts
const store = new MemoryOAuthPkceStateStore();
const state = store.start({
  state: "state-1",
  providerId: "github",
  redirectUri: "https://app.example.com/oauth/callback",
  codeVerifier,
  ttlMs: 300_000,
});

const result = store.consume({
  state: "state-1",
  code: "provider-code",
  redirectUri: state.redirectUri,
});
if (result.status !== "valid") throw new Error("invalid OAuth callback");
\`\`\`

## Integration Rules

1. Generate high-entropy state and code_verifier values.
2. Store only the code challenge, not the verifier, unless your flow requires server-side verifier custody.
3. Verify state before token exchange.
4. Verify redirect_uri matches the original login start.
5. Consume valid state exactly once.
6. Expire old states aggressively.

## Failure Modes

- Missing state allows CSRF-style callback confusion.
- State reuse allows replay after a successful callback.
- Redirect URI mismatch can bind a callback to the wrong client flow.
- Memory stores lose pending login state on restart.
- Provider errors are treated as local success.

## Security Notes

- Use S256 PKCE, not plain challenges.
- Store OAuth state in Redis/SQL/session-backed storage for production.
- Bind state metadata to tenant, session, or return URL policy.
- Never exchange provider tokens after state verification fails.

## Verification Checklist

- Stateless tests cover PKCE S256 challenge, verifier validation, state creation, missing state/code, provider error, state mismatch, redirect mismatch, expiry, consume, fail, and clone safety.
- Stateful tests cover start, duplicate state rejection, verify, consume once, replay rejection, fail, pruneExpired, list, and clone-safe records.
- Redis/SQL adapters should test atomic one-time consume and TTL expiry.
- Provider integration tests should verify token exchange only runs after valid state.

## Source References

- OAuth 2.0 authorization code with PKCE.
- OAuth state CSRF protection patterns.
- Redis SET NX EX one-time nonce/state storage.
- Session-bound OAuth callback validation.
`;

export const OAUTH_PKCE_STATE_MODULE: MwhModule = {
  id: "oauth-pkce-state",
  title: "OAuth PKCE State",
  summary:
    "Reusable auth-security reference for OAuth state, PKCE S256 challenge, callback verification, one-time consume, and stateful replay tests.",
  version: "0.1.0",
  tags: ["auth-security", "oauth", "pkce", "state", "csrf", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
