import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { findFreePort, parsePortRange } from './ports.js'
import * as registry from './registry.js'
import { startAgent } from './agent-host.js'

const RUNTIME_PORT = Number(process.env.PORT ?? 3030)
const AGENT_PORT_RANGE = parsePortRange(
  process.env.WAYPOINT_AGENT_PORT_RANGE ?? '4000-4999',
)
const BUNDLE_CACHE =
  process.env.WAYPOINT_BUNDLE_CACHE ?? path.join(os.tmpdir(), 'waypoint-runtime-cache')

await fs.mkdir(BUNDLE_CACHE, { recursive: true })

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res)
  } catch (err) {
    console.error('[runtime] unhandled:', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal', message: String(err) }))
    }
  }
})

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${RUNTIME_PORT}`)

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'runtime', agents: registry.list().length }))
    return
  }

  if (url.pathname === '/v1/internal/agents' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify(
        registry.list().map((a) => ({
          agentId: a.agentId,
          deploymentId: a.deploymentId,
          port: a.port,
          startedAt: a.startedAt.toISOString(),
        })),
      ),
    )
    return
  }

  const claimMatch = url.pathname.match(/^\/v1\/internal\/agents\/([^/]+)\/claim$/)
  if (req.method === 'POST' && claimMatch) {
    await handleClaim(claimMatch[1]!, req, res)
    return
  }

  const invokeMatch = url.pathname.match(/^\/v1\/internal\/agents\/([^/]+)\/invoke$/)
  if (req.method === 'POST' && invokeMatch) {
    await handleInvoke(invokeMatch[1]!, req, res)
    return
  }

  const releaseMatch = url.pathname.match(/^\/v1\/internal\/agents\/([^/]+)$/)
  if (req.method === 'DELETE' && releaseMatch) {
    const removed = registry.remove(releaseMatch[1]!)
    res.writeHead(removed ? 204 : 404)
    res.end()
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not_found' }))
}

async function handleClaim(
  agentId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const deploymentId = req.headers['x-waypoint-deployment-id']
  const buildHash = req.headers['x-waypoint-build-hash']
  if (typeof deploymentId !== 'string' || typeof buildHash !== 'string') {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing_deployment_headers' }))
    return
  }

  const body = await readBody(req)
  if (body.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'empty_body' }))
    return
  }

  const cacheDir = path.join(BUNDLE_CACHE, buildHash)
  await fs.mkdir(cacheDir, { recursive: true })
  const bundlePath = path.join(cacheDir, 'bundle.mjs')
  await fs.writeFile(bundlePath, body)

  const port = await findFreePort(AGENT_PORT_RANGE, registry.usedPorts())
  const started = await startAgent(bundlePath, port)

  registry.put({
    agentId,
    deploymentId,
    buildHash,
    port: started.port,
    url: started.url,
    close: started.close,
    startedAt: new Date(),
  })

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ port: started.port, url: started.url }))
}

async function handleInvoke(
  agentId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const rec = registry.get(agentId)
  if (!rec) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'agent_not_found' }))
    return
  }

  await forwardHttp(req, res, `${rec.url}/`)
}

function forwardHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(target)
    const opts: http.RequestOptions = {
      method: req.method,
      hostname: u.hostname,
      port: u.port,
      path: (u.pathname || '/') + u.search,
      headers: filterRequestHeaders(req.headers),
    }
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      proxyRes.pipe(res)
    })
    proxyReq.once('error', reject)
    req.pipe(proxyReq)
    res.once('close', () => resolve())
  })
}

function filterRequestHeaders(h: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {}
  for (const [k, v] of Object.entries(h)) {
    if (k.startsWith('x-waypoint-')) continue
    if (k === 'host' || k === 'connection' || k === 'content-length') continue
    if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.once('end', () => resolve(Buffer.concat(chunks)))
    req.once('error', reject)
  })
}

server.listen(RUNTIME_PORT, () => {
  console.log(`[runtime] listening on http://127.0.0.1:${RUNTIME_PORT}`)
  console.log(`[runtime] agent ports: ${AGENT_PORT_RANGE.from}-${AGENT_PORT_RANGE.to}`)
  console.log(`[runtime] bundle cache: ${BUNDLE_CACHE}`)
})