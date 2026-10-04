# Waypoint

Serverless deployment platform for Mastra agents. Self-hosted, single host, no auth in v1.

## Quickstart

```bash
docker compose up -d

mkdir hello-agent && cd hello-agent
waypoint init
pnpm install
waypoint deploy

curl -X POST http://localhost:3000/v1/agents/hello-agent/invoke \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

## Commands

```bash
waypoint init                                # scaffold
waypoint deploy                              # ship code
waypoint agents list                         # fleet + active minutes
waypoint agents restart <id>                 # bounce runtime
waypoint agents scale <id> --replicas N      # manual scaling
waypoint logs <id> --follow                  # live stdout
waypoint state get|set <agent> <key> [val]   # debug state
```

## Spec

See [PLAN.md](./PLAN.md) for HTTP API, data model, runtime contract, SDK, metering, and self-host layout.

- Node 20+
- pnpm
- Docker