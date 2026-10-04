<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Waypoint

Serverless deployment platform for Mastra agents. Self-hosted v1, no auth.

The full spec is `PLAN.md` — read it before touching `/v1/...` routes, the server↔runtime contract, or the data model.

## Layout

```
packages/
├── cli/        @sardonic-labs/waypoint         global `waypoint` bin
├── server/     @sardonic-labs/waypoint-server  control plane, port 3000
├── runtime/    @sardonic-labs/waypoint-runtime child process host, port 3030
└── sdk/        @sardonic-labs/waypoint-sdk    state k/v for agents (runtime-imported)
examples/
└── hello-agent/                                MVP-0 deploy target
PLAN.md                                         full v1 spec
docker-compose.yml                              postgres for dev
turbo.json                                      build pipeline
```

Dashboard is not in the repo yet. Built after the metering/logs layer lands.

## Commands

```bash
pnpm build       # tsc all packages
pnpm dev         # parallel: server + runtime
pnpm typecheck   # tsc --noEmit
pnpm clean       # rimraf dist + .tsbuildinfo
```

Per-package: `pnpm --filter <name> <script>`.

## Conventions

- ESM. No `require`.
- TS strict + `noUncheckedIndexedAccess`. Don't relax.
- Server↔runtime coupling is HTTP at `WAYPOINT_RUNTIME_URL` (default `http://127.0.0.1:3030`). Nothing else.
- Runtime pulls bundles from server at `WAYPOINT_SERVER_URL` (default `http://127.0.0.1:3000`), caches by sha256.
- Server is the only writer of `agents`/`deployments`/`invocations`. Runtime holds an in-process registry; resets on restart.

## Status

Done: runtime MVP-0, CLI MVP-0, server MVP-0, SDK MVP-0 (`waypointMastraTools` + state RPC over HTTP on `/__waypoint/state`, persisted in `state_kv`).

Next: metering (`active_minute_rollups`) → dashboard → self-host packaging. Logs streaming sits between metering and dashboard — needed before the dashboard's invocation page is useful. Contracts at `PLAN.md`.