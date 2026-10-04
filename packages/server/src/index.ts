import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import { mkdir } from 'node:fs/promises'
import { config } from './waypoint-config.js'
import { listAgents, createAgent, getAgent, deleteAgent } from './routes/agents.js'
import { createDeployment } from './routes/deployments.js'
import { invokeAgent } from './routes/invoke.js'
import { serveArtifact } from './routes/artifacts.js'
import { httpError } from './errors.js'
import { runtimeHealth } from './runtime-client.js'

await mkdir(config.artifactsDir, { recursive: true })

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res)
  } catch (err) {
    console.error('[server] unhandled:', err)
    if (!res.headersSent) httpError(res, 500, 'internal', String(err))
  }
})

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  httpError(res, 404, 'not_found', `no route for ${req.method} ${url.pathname}`)
}

server.listen(config.port, () => {
  console.log(`[server] listening on http://127.0.0.1:${config.port}`)
  console.log(`[server] runtime at ${config.runtimeUrl}`)
  console.log(`[server] artifacts at ${config.artifactsDir}`)
})