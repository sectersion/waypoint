# Waypoint — Spec
# v1 = Mastra agents, self-hosted, single host, no auth.

## Context

Companies building production Mastra agents re-solve the same operational problems every time: isolation, scaling, zero-downtime rollout, persistent state, cost metering, observability. Today they wire this up by hand — Docker, sidecar Postgres, custom scripts, bespoke monitoring. Waypoint eliminates that work.

**v1 target:** Mastra agents only. The SDK exposes Mastra tools; other frameworks are not supported in v1.

**v1 scope:** self-hosted, single host, single tenant, no auth. Operator uses local CLI; agents are reachable on the host's network. Self-hosters put a reverse proxy in front if they need auth.

**v1 runtime:** `child_process`. Firecracker microVM swap is planned for v1.x without server changes — the runtime contract is HTTP.

## Product shape

1. **Write** — agent code in Mastra + `@sardonic-labs/waypoint-sdk`
2. **Deploy** — `waypoint deploy` bundles and ships
3. **Run** — Waypoint builds, isolates, scales
4. **Pay** — per-active-minute metering, surfaced in CLI and dashboard
5. **Operate** — `waypoint agents list`, `restart`, `scale`, `logs`, `state`

## Architecture

Five packages in one monorepo, all TypeScript:

```
waypoint/
├── packages/
│   ├── cli/          # `waypoint` — deploy + inspect
│   ├── sdk/          # @sardonic-labs/waypoint-sdk — Mastra tools + runtime helpers
│   ├── server/       # control plane API + Postgres + log relay
│   ├── runtime/      # child_process host (v1), Firecracker (v1.x)
│   └── dashboard/    # server-rendered HTML (no Next.js)
├── docker-compose.yml  # self-host: server + runtime + postgres + dashboard
├── examples/
│   └── hello-agent/   # Mastra + Waypoint smoke
└── PLAN.md
```

**Package roles**

- **CLI (`@sardonic-labs/waypoint`)** — global npm install. Scaffolds, talks to server REST. Configured per-project via `waypoint.json`.
- **SDK (`@sardonic-labs/waypoint-sdk`)** — imported inside the agent bundle. Public surface is `waypointMastraTools()` (Mastra tools). Internal surface is `waypoint.state.{get,set,delete}` over a Unix socket, used by the SDK's own tools.
- **Server (`@sardonic-labs/waypoint-server`)** — REST + WebSocket. Owns Postgres. Routes public traffic to runtime. Meters.
- **Runtime (`@sardonic-labs/waypoint-runtime`)** — host process. Pulls deploy artifacts. Spawns one Node.js child process per agent replica. Streams logs. Talks to server via HTTP.
- **Dashboard (`@sardonic-labs/waypoint-dashboard`)** — server-rendered HTML served by the server on a separate port. Two pages: fleet, per-agent detail. Live updates via SSE.

## Data model

Drizzle on Postgres. No `teams`/`users` in v1 — single tenant per server.

```typescript
// packages/server/src/db/schema.ts
import {
  pgTable, uuid, text, timestamp, integer, jsonb, primaryKey,
} from 'drizzle-orm/pg-core'

export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  currentDeploymentId: uuid('current_deployment_id'),
  replicas: integer('replicas').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const deployments = pgTable('deployments', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  version: integer('version').notNull(),
  buildHash: text('build_hash').notNull(),       // sha256 of bundle.mjs
  env: jsonb('env').notNull().default({}),       // env from waypoint.json
  status: text('status').notNull(),              // pending|active|failed|superseded
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const invocations = pgTable('invocations', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  deploymentId: uuid('deployment_id').notNull().references(() => deployments.id),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  statusCode: integer('status_code'),
})

export const stateKv = pgTable('state_kv', {
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.key] }),
}))

export const activeMinuteRollups = pgTable('active_minute_rollups', {
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  bucketStart: timestamp('bucket_start').notNull(),  // aligned to minute boundary
  activeSeconds: integer('active_seconds').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.bucketStart] }),
}))
```

Bucket math: `bucket_start = floor(started_at_seconds / 60) * 60`.

## HTTP API (public)

All paths prefixed `/v1`. JSON unless noted. Errors: `{"error":{"code":"...","message":"..."}}` with appropriate 4xx/5xx status. **No auth headers required in v1.**

### Agent management

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET    | `/v1/agents`                          | —                                                 | `[{id,name,replicas,currentDeploymentId,createdAt}]` |
| POST   | `/v1/agents`                          | `{name}`                                          | `{id,name,replicas:1,currentDeploymentId:null}` |
| GET    | `/v1/agents/:id`                      | —                                                 | agent + last 10 deployments + last 60s usage |
| POST   | `/v1/agents/:id/deployments`          | multipart: `manifest` (JSON), `bundle` (file)     | `{deploymentId,version}` |
| GET    | `/v1/agents/:id/deployments`          | —                                                 | `[{id,version,buildHash,status,createdAt}]` |
| POST   | `/v1/agents/:id/restart`              | —                                                 | `{ok:true}` |
| POST   | `/v1/agents/:id/scale`                | `{replicas:N}`                                    | `{replicas:N}` |
| GET    | `/v1/agents/:id/usage?from=&to=`      | —                                                 | `[{bucketStart,activeSeconds}]` |

`POST /v1/agents/:id/deployments` accepts a manifest:

```json
{ "entrypoint": "src/index.ts", "nodeVersion": "20", "env": {"OPENAI_API_KEY":"..."} }
```

### Invocation

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST   | `/v1/agents/:id/invoke`              | arbitrary, streamed | streamed agent response (pass-through) |
| GET    | `/v1/agents/:id/invoke`              | —                  | same, for SSE/WebSocket-style callers |

Server forwards request headers + body to the runtime, which forwards to a child process. Response is streamed back. On completion, server writes the `invocations` row and updates `active_minute_rollups`.

### State

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET    | `/v1/agents/:id/state/:key`          | —                  | `{value}` or 404 |
| PUT    | `/v1/agents/:id/state/:key`          | `{value}`          | `{ok:true}` |
| DELETE | `/v1/agents/:id/state/:key`          | —                  | `{ok:true}` |

State is public on v1. Used by the SDK inside the agent and by `waypoint state` CLI.

### Logs

| Method | Path | Body | Response |
|--------|------|------|----------|
| WS     | `/v1/agents/:id/logs/stream?since=`  | —                  | NDJSON frames (see Logging protocol) |
| GET    | `/v1/agents/:id/logs?since=&limit=`  | —                  | `[{ts,deploymentId,stream,line}]` |

## Server ↔ Runtime contract

Runtime URL configured on server via `WAYPOINT_RUNTIME_URL` (default `http://127.0.0.1:3030`). Server treats runtime as an HTTP service it forwards to.

### Server → Runtime

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST   | `/v1/internal/agents/:id/claim`     | `{deploymentId,buildUrl,env}` | 204 |
| DELETE | `/v1/internal/agents/:id/release`   | —                                       | 204 |
| POST   | `/v1/internal/agents/:id/restart`   | —                                       | 204 |
| POST   | `/v1/internal/agents/:id/invoke`    | streamed request                        | streamed response |
| GET    | `/v1/internal/agents/:id/logs/tail?since=` | —                                  | NDJSON frames |

`buildUrl` is `/v1/internal/artifacts/:deploymentId/bundle`. Runtime fetches it, caches by `buildHash` at `/var/waypoint/runtime/cache/<buildHash>/bundle.mjs`.

On `claim`:
- If agent already running: SIGTERM current child, wait up to 10s, then spawn new child.
- Spawn `node <bundle.mjs>` with env `{WAYPOINT_AGENT_ID, WAYPOINT_DEPLOYMENT_ID, WAYPOINT_STATE_SOCKET}`.
- Pick a free port from `WAYPOINT_AGENT_PORT_RANGE` (default 4000–4999), start the Mastra harness on it.

On `release`:
- SIGTERM the child, close the socket, free the port.

### Runtime → Server

Runtime is a passive client; it pulls from server. State RPC is local: runtime listens on the Unix socket path it gave the child at boot. Logs are pushed to server on the `tail` endpoint via long-poll or short-poll (implementation detail; runtime is the source of truth, server forwards).

Health: `GET /health` on the runtime returns `{ok:true, agents:[{id,deploymentId,port,pid}]}`. Server polls every 10s; if runtime is down, `/v1/agents/:id/invoke` returns 503 `{"error":{"code":"runtime_unavailable"}}`.

## SDK

`@sardonic-labs/waypoint-sdk` has two surfaces.

### Public — what user code calls

```typescript
import { waypointMastraTools } from '@sardonic-labs/waypoint-sdk'

// returns { stateGet, stateSet, stateDelete } as Mastra Tools
const tools = waypointMastraTools()
```

The three tools:

```typescript
waypointMastraTools() : {
  stateGet:    Tool<{key:string}, unknown>,
  stateSet:    Tool<{key:string, value:unknown}, {ok:boolean}>,
  stateDelete: Tool<{key:string}, {ok:boolean}>,
}
```

### Internal — used by the SDK's own tools

```typescript
import { waypoint } from '@sardonic-labs/waypoint-sdk/internal'
// NOT re-exported from the package root — only the SDK's tools import this

waypoint.state.get(key)    : Promise<unknown>
waypoint.state.set(key, v) : Promise<void>
waypoint.state.delete(key) : Promise<void>
```

These open a Unix socket at `process.env.WAYPOINT_STATE_SOCKET` lazily on first call and exchange line-delimited JSON:

```
→ {"op":"get","key":"counter"}
← {"ok":true,"value":42}
→ {"op":"set","key":"counter","value":43}
← {"ok":true}
→ {"op":"delete","key":"counter"}
← {"ok":true}
```

Socket path includes the agent id so the runtime can demux:
`/tmp/waypoint/<agent_id>.sock`.

The runtime listens on every such socket. On each request it reads/writes the `state_kv` table directly via its own DB connection. The runtime is the only writer of `state_kv`; the server is bypassed.

**Why a socket and not HTTP.** The agent bundle is plain Node.js with arbitrary user code. HTTP would require the agent to bind a port and surface the URL, leaking infra concerns into user code and producing a boot race. The socket is created by the runtime before the child process spawns; the SDK opens it lazily on first call.

## Mastra integration

Runtime wraps the agent bundle's default export in a Node HTTP server using Mastra's official Node adapter. The exact package name depends on the Mastra version pinned at SDK build time (verification step in phase 2: read Mastra's docs, confirm package name and import shape, codify in `packages/runtime/src/agent-host.ts`). The contract is:

```typescript
// runtime/src/agent-host.ts
import { createServer } from '<mastra-node-adapter>'  // name verified in phase 2
import type { Agent } from '@mastra/core/agent'

export async function startAgent(
  bundlePath: string,
  port: number,
  env: Record<string,string>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const mod = await import(bundlePath)
  const agent: Agent = mod.default
  const server = createServer(agent)
  // run with env applied
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => err ? reject(err) : resolve())),
  }
}
```

If Mastra's adapter requires explicit env injection (it likely does), `startAgent` propagates `env` to `process.env` of the child before `import()`. The harness does **not** monkey-patch Mastra — it uses the public Node adapter, whatever it is.

## Build artifact

`waypoint deploy` runs esbuild over the entrypoint:

```bash
esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=./.waypoint/bundle.mjs \
  --external:'#waypoint'
```

`#waypoint` is a runtime-resolved import alias the SDK uses to pull its own code. It is **not** bundled into the agent; the runtime's image already has the SDK, and using `#waypoint` avoids version drift between user and runtime SDKs.

The CLI computes `sha256(bundle.mjs)` and POSTs the bundle + manifest as multipart:

```
POST /v1/agents/:id/deployments HTTP/1.1
Content-Type: multipart/form-data; boundary=...

--...
Content-Disposition: form-data; name="manifest"
Content-Type: application/json

{"entrypoint":"src/index.ts","nodeVersion":"20","env":{"OPENAI_API_KEY":"..."}}
--...
Content-Disposition: form-data; name="bundle"; filename="bundle.mjs"
Content-Type: application/javascript

<binary>
--...--
```

Server:
1. Streams bundle to `WAYPOINT_ARTIFACTS_DIR/<agent_id>/<deployment_id>/bundle.mjs`.
2. Verifies sha256 against manifest; rejects on mismatch.
3. INSERTs `deployments` row with `version = max(version)+1 for this agent` and `status='pending'`.
4. UPDATE `agents.current_deployment_id = newDeployment.id`.
5. POST `/v1/internal/agents/:id/claim` to runtime with `{deploymentId, buildUrl, env}`.
6. UPDATE `deployments.status='active'` after runtime returns 204. (Runtime errors leave `status='failed'`.)
7. UPDATE prior `deployments.status='superseded'`.

## CLI commands

All commands read `waypoint.json` from cwd. Env overrides: `WAYPOINT_SERVER`, `WAYPOINT_AGENT`. No auth.

### `waypoint init`

Scaffolds `src/index.ts`, `waypoint.json`, `package.json`, `.gitignore`. Asks for agent name. Writes a working Mastra agent using `waypointMastraTools()`.

### `waypoint deploy [--watch]`

1. Read `waypoint.json`.
2. POST `/v1/agents` with `{name}`; ignore 409.
3. Bundle entrypoint with esbuild → `.waypoint/bundle.mjs`.
4. POST multipart to `/v1/agents/:id/deployments`.
5. Print `→ deployed <name> v<N> (<short-sha>)`.

`--watch`: re-bundle and re-deploy on file change.

### `waypoint agents list`

GET `/v1/agents`. Prints:

```
ID                                    NAME               REPLICAS   ACTIVE/MIN   DEPLOYED
abc123...                             hello-agent        1          0.4          2 min ago
```

`ACTIVE/MIN` = sum of `active_minute_rollups` for the last 60 seconds, divided by 60.

### `waypoint agents restart <id>`

POST `/v1/agents/:id/restart`. Prints `→ restarted <id>`.

### `waypoint agents scale <id> --replicas N`

POST `/v1/agents/:id/scale` with `{replicas:N}`. Prints `→ scaled <id> to N replicas`.

### `waypoint logs <id> [--since <rfc3339>] [--follow]`

WS to `/v1/agents/:id/logs/stream`. Prints each frame as `<ts> <stream> <line>`. `--follow` keeps the stream open (default); without it, exits after 30s of no new lines.

### `waypoint state get <agent> <key>`

GET `/v1/agents/:agent/state/:key`. Prints value as JSON.

### `waypoint state set <agent> <key> <value>`

PUT `/v1/agents/:agent/state/:key`. Value parsed as JSON if possible, else string.

## Logging protocol

Runtime tails each agent's child process stdout/stderr line-by-line. Each line becomes:

```json
{"ts":"2026-01-15T10:30:00.123Z","deploymentId":"...","stream":"stdout","line":"hello"}
```

Runtime buffers the last 1000 lines per agent in memory for the `/v1/internal/agents/:id/logs/tail` endpoint. Server forwards those frames to its WS subscribers (CLI, dashboard).

`--since=<rfc3339>` filters server-side: only frames with `ts >= since` are sent.

## Metering

Per invocation:

```
started_at = Date.now() at request start
stream response from runtime
on stream end (success, error, or abort):
  ended_at = Date.now()
  duration_seconds = max(1, ceil((ended_at - started_at) / 1000))
  bucket_start = floor(started_at / 60000) * 60000
  UPSERT active_minute_rollups
    SET active_seconds = active_seconds + duration_seconds
    WHERE agent_id = :id AND bucket_start = :bucket_start
  INSERT invocations (agent_id, deployment_id, started_at, ended_at, status_code)
```

`waypoint agents list`'s `ACTIVE/MIN` = sum of `active_seconds` for the last two bucket_starts, divided by 60. (Two buckets cover the rolling 60s window without off-by-one.)

## Wire examples

### Deploy

```bash
$ waypoint deploy
→ bundled 1.2 MB (sha256: abc123...)
→ POST /v1/agents/hello-agent/deployments
→ deployed hello-agent v3 (abc123)
```

### Invoke

```bash
$ curl -X POST http://localhost:3000/v1/agents/hello-agent/invoke \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"hi"}]}'
{"reply":"hi! call count: 4"}
```

### State

```bash
$ waypoint state get hello-agent counter
42
$ waypoint state set hello-agent counter 100
✓
```

### Logs

```bash
$ waypoint logs hello-agent --follow
2026-01-15T10:30:00.123Z stdout Mastra agent ready
2026-01-15T10:30:05.456Z stdout invocation 7f... started
2026-01-15T10:30:06.789Z stdout invocation 7f... ended (1.3s)
```

### Errors

```bash
$ curl http://localhost:3000/v1/agents/nonexistent/invoke -d '{}'
HTTP/1.1 404 Not Found
{"error":{"code":"agent_not_found","message":"no agent with id 'nonexistent'"}}
```

## Configuration

### `waypoint.json` (per project)

```json
{
  "server":      "http://localhost:3000",
  "agent":       "hello-agent",
  "entrypoint":  "src/index.ts",
  "env":         { "OPENAI_API_KEY": "sk-..." }
}
```

`env` is sent on every deploy and applied to the agent's process at runtime.

### Server env

| Var | Default | Description |
|-----|---------|-------------|
| `PORT`                       | 3000                          | Public HTTP port |
| `DATABASE_URL`               | postgres://waypoint:waypoint@localhost:5432/waypoint | Postgres |
| `WAYPOINT_RUNTIME_URL`       | http://127.0.0.1:3030         | Forward invocations here |
| `WAYPOINT_ARTIFACTS_DIR`     | /var/waypoint/artifacts       | Where bundles are stored |
| `WAYPOINT_DASHBOARD_PORT`    | 3001                          | Dashboard listen port (0 to disable) |
| `WAYPOINT_LOG_BUFFER`        | 1000                          | Lines buffered per agent for tail |

### Runtime env

| Var | Default | Description |
|-----|---------|-------------|
| `PORT`                       | 3030                          | Internal HTTP port |
| `WAYPOINT_SERVER_URL`        | http://127.0.0.1:3000         | Fetch bundles from server |
| `DATABASE_URL`               | postgres://waypoint:waypoint@localhost:5432/waypoint | Direct DB for state RPC |
| `WAYPOINT_AGENT_PORT_RANGE`  | 4000-4999                     | Ports assigned to agent child processes |

## Self-host layout

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: waypoint
      POSTGRES_PASSWORD: waypoint
      POSTGRES_DB: waypoint
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: pg_isready -U waypoint
      interval: 5s

  migrate:
    image: node:20-alpine
    depends_on: { postgres: { condition: service_healthy } }
    environment: { DATABASE_URL: postgres://waypoint:waypoint@postgres:5432/waypoint }
    volumes: [.:/app]
    working_dir: /app
    command: sh -c "corepack enable && pnpm install && pnpm --filter @sardonic-labs/waypoint-server db:migrate"

  server:
    build: { context: ., dockerfile: packages/server/Dockerfile }
    depends_on: { migrate: { condition: service_completed_successfully } }
    environment:
      DATABASE_URL: postgres://waypoint:waypoint@postgres:5432/waypoint
      WAYPOINT_RUNTIME_URL: http://runtime:3030
    ports: ['3000:3000']
    volumes: [artifacts:/var/waypoint/artifacts]

  runtime:
    build: { context: ., dockerfile: packages/runtime/Dockerfile }
    depends_on: { server: { condition: service_started } }
    environment:
      WAYPOINT_SERVER_URL: http://server:3000
      DATABASE_URL: postgres://waypoint:waypoint@postgres:5432/waypoint

  dashboard:
    build: { context: ., dockerfile: packages/dashboard/Dockerfile }
    depends_on: [server]
    ports: ['3001:3001']

volumes:
  pgdata: {}
  artifacts: {}
```

`migrate` runs Drizzle migrations once and exits. Server waits for `service_completed_successfully`.

## Smoke (verification)

End-to-end happy path, single agent, self-hosted:
1. `pnpm i && pnpm -r build`
2. `docker compose up -d` — server, runtime, postgres, dashboard come up; `migrate` exits 0
3. `cd examples/hello-agent && pnpm install && waypoint deploy`
   - Expected: `→ deployed hello-agent v1`
4. `curl -X POST http://localhost:3000/v1/agents/hello-agent/invoke -d '{"messages":[{"role":"user","content":"hi"}]}'`
   - Expected: agent reply
5. Repeat step 4. Second reply references state from first (e.g. call count incremented via `waypoint-state-set`).
6. `waypoint agents list` — shows `hello-agent`, `ACTIVE/MIN` ticking.
7. `waypoint logs hello-agent --follow` — shows the two invocations and their stdout.
8. `curl http://localhost:3001` (dashboard) — shows `hello-agent` with active minutes ticking.

Load smoke:
- 50 concurrent invocations on `hello-agent` → all return 200; `ACTIVE/MIN` reflects wall-clock.

Billing smoke:
- One invocation, manually inject 5s sleep in agent → `active_minute_rollups` row has `active_seconds = 5`.
- Two invocations overlapping in the same minute bucket → row has sum of both durations.

## Out of scope (v1)

- **No auth** — operator or end-user. Anyone with network access to the server can invoke agents. Self-hosters put a reverse proxy in front.
- **No multi-tenant** — single team/owner per server. No `teams` table, no user accounts.
- **No multi-host runtime** — single host only.
- **No multi-region, no auto-scaling** — manual `waypoint scale --replicas N`.
- **No SaaS runtime** — post-v1.
- **No token metering, no cost dashboards beyond per-agent active-minute total.**
- **No zero-downtime deploys** — redeploy SIGTERMs the old child, brief downtime acceptable in v1.
- **No egress controls** — agents can hit the network freely.

## v1.x (planned, no work until v1 ships)

- **Firecracker microVM host.** Runtime contract unchanged. v1.x runtime is a drop-in for `packages/runtime`.
- **Per-agent egress allowlist.**
- **Snapshot/warm-pool** for sub-100ms cold starts.
- **Zero-downtime deploys** (drain + new).

## Phases

1. **CLI + server + SDK + Mastra runtime adapter.** `waypoint deploy` creates rows; runtime spawns the bundle via Mastra's Node adapter; `curl /v1/agents/:id/invoke` returns a real reply. `examples/hello-agent` deploys.
2. **State + metering.** SDK's `waypoint.state.*` over Unix socket; runtime writes `state_kv`; `active_minute_rollups` advances on every invocation; `waypoint agents list` shows `ACTIVE/MIN`.
3. **Logs + dashboard.** Child stdout/stderr → NDJSON tail → WS CLI; server-rendered dashboard.
4. **Self-host packaging.** `docker-compose.yml`; CLI + SDK published to npm under `@sardonic-labs/*`.
5. **Polish + docs.** `README.md`, `examples/`, error messages, smoke tests.

(Post-v1: SaaS runtime on shared infrastructure, multi-region, auto-scaling, teams, billing integration.)

## Build order for first session

Phase 1–3, smallest end-to-end first:

1. Repo skeleton (`packages/{cli,sdk,server,runtime,dashboard}`, `examples/hello-agent`, root `package.json`, `tsconfig.json`, `pnpm-workspace.yaml`).
2. Server: Drizzle schema + migrations; agent CRUD; deploy endpoint (multipart upload, stores bundle at `WAYPOINT_ARTIFACTS_DIR`).
3. Runtime: `/v1/internal/agents/:id/claim` and `/invoke`; spawns `node <bundle.mjs>` and proxies HTTP to it via Mastra's Node adapter (verify package name and write `agent-host.ts`).
4. CLI: `waypoint init`, `waypoint deploy`, `waypoint agents list`. No auth headers sent.
5. End-to-end smoke: `waypoint deploy` → `curl /v1/agents/:id/invoke` returns a real reply from the bundled agent.
6. SDK: `waypointMastraTools()`, internal `waypoint.state.*` over Unix socket; runtime listens on `/tmp/waypoint/<id>.sock`, reads/writes `state_kv` via DB. Second invocation sees state from first.
7. Metering: invocation start/end → UPSERT `active_minute_rollups`; `ACTIVE/MIN` shows in `waypoint agents list`.
8. Logs: child stdout/stderr → NDJSON tail → WS CLI. `waypoint logs <id> --follow` streams.