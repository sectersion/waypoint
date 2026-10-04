import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import { mkdir } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { config } from './waypoint-config.js'
import { listAgents, createAgent, getAgent, deleteAgent } from './routes/agents.js'
import { createDeployment } from './routes/deployments.js'
import { invokeAgent } from './routes/invoke.js'
import { serveArtifact } from './routes/artifacts.js'
import { appendLogs, tailAgentLogs } from './routes/logs.js'
import { listInvocations, listStateKv } from './routes/invocations.js'
import { httpError } from './errors.js'
import { runtimeHealth } from './runtime-client.js'

await mkdir(config.artifactsDir, { recursive: true })

// ponytail: self-hosted v1, no manual db:migrate step. Run on boot; if a
// migration breaks, the server crashes and the operator sees the error.
{
  const pool = new Pool({ connectionString: config.databaseUrl })
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('[server] migrations applied')
  await pool.end()
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res)
  } catch (err) {
    console.error('[server] unhandled:', err)
    if (!res.headersSent) httpError(res, 500, 'internal', String(err))
  }
})

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // ponytail: CORS for the static dashboard on a different port. Self-hosted
  // v1, no auth — * is fine. Tighten on v1.x if it ever lands.
  res.setHeader('access-control-allow-origin', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.port}`)

  if (url.pathname === '/health' && req.method === 'GET') {
    const rt = await runtimeHealth()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'server', runtime: rt }))
    return
  }

  if (url.pathname === '/v1/agents' && req.method === 'GET') return listAgents(res)
  if (url.pathname === '/v1/agents' && req.method === 'POST') return createAgent(req, res)

  const agentMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)$/)
  if (agentMatch) {
    const id = agentMatch[1]!
    if (req.method === 'GET')    return getAgent(id, res)
    if (req.method === 'DELETE') return deleteAgent(id, res)
  }

  const depMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/deployments$/)
  if (depMatch && req.method === 'POST') {
    return createDeployment(depMatch[1]!, req, res)
  }

  const invokeMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/invoke$/)
  if (invokeMatch && req.method === 'POST') {
    return invokeAgent(invokeMatch[1]!, req, res)
  }

  const artifactMatch = url.pathname.match(/^\/v1\/internal\/artifacts\/([^/]+)\/bundle$/)
  if (artifactMatch && req.method === 'GET') {
    return serveArtifact(artifactMatch[1]!, res)
  }

  const logsAppendMatch = url.pathname.match(/^\/v1\/internal\/logs\/([^/]+)$/)
  if (logsAppendMatch && req.method === 'POST') {
    return appendLogs(logsAppendMatch[1]!, req, res)
  }

  const agentLogsMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/logs$/)
  if (agentLogsMatch && req.method === 'GET') {
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? '100')))
    return tailAgentLogs(agentLogsMatch[1]!, limit, res)
  }

  const invocationsMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/invocations$/)
  if (invocationsMatch && req.method === 'GET') {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? '50')))
    return listInvocations(invocationsMatch[1]!, limit, res)
  }

  const stateKvMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)\/state$/)
  if (stateKvMatch && req.method === 'GET') {
    return listStateKv(stateKvMatch[1]!, res)
  }

  httpError(res, 404, 'not_found', `no route for ${req.method} ${url.pathname}`)
}

server.listen(config.port, () => {
  console.log(`[server] listening on http://127.0.0.1:${config.port}`)
  console.log(`[server] runtime at ${config.runtimeUrl}`)
  console.log(`[server] artifacts at ${config.artifactsDir}`)
})