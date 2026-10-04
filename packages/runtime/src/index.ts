import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { findFreePort, parsePortRange } from './ports.js'
import * as registry from './registry.js'
import { startAgent } from './agent-host.js'

const RUNTIME_PORT = Number(process.env.PORT ?? 3030)
const AGENT_PORT_RANGE = parsePortRange(
  process.env.WAYPOINT_AGENT_PORT_RANGE ?? '4000-4999',
)
const BUNDLE_CACHE =
  process.env.WAYPOINT_BUNDLE_CACHE ?? path.join(os.tmpdir(), 'waypoint-runtime-cache')
const SERVER_URL =
  process.env.WAYPOINT_SERVER_URL ?? 'http://127.0.0.1:3000'

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

  const releaseMatch = url.pathname.match(/^\/v1\/internal\/agents\/([^/]+)\/release$/)
  if (req.method === 'DELETE' && releaseMatch) {
    const removed = registry.remove(releaseMatch[1]!)
    res.writeHead(removed ? 204 : 404).end()
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not_found' }))
}

interface ClaimBody {
  deploymentId: string
  buildUrl: string
  env: Record<string, string>
}

async function handleClaim(
  agentId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = (await readJson(req)) as Partial<ClaimBody> | null
  const deploymentId = body?.deploymentId
  const buildUrl = body?.buildUrl
  const env = body?.env
  if (typeof deploymentId !== 'string' || typeof buildUrl !== 'string' || !env || typeof env !== 'object') {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'bad_claim', message: 'expected {deploymentId, buildUrl, env}' }))
    return
  }

  const fetchUrl = buildUrl.startsWith('http') ? buildUrl : `${SERVER_URL}${buildUrl}`
  const bundleRes = await fetch(fetchUrl)
  if (!bundleRes.ok) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'bundle_fetch_failed', status: bundleRes.status }))
    return
  }
  const buf = Buffer.from(await bundleRes.arrayBuffer())
  const buildHash = createHash('sha256').update(buf).digest('hex')

  const cacheDir = path.join(BUNDLE_CACHE, buildHash)
  await fs.mkdir(cacheDir, { recursive: true })
  const bundlePath = path.join(cacheDir, 'bundle.mjs')
  await fs.writeFile(bundlePath, buf)

  // ponytail: env is recorded on the agent record but not injected into
  // process.env. MVP-0 runs agents in-process (this same Node process); v1.x
  // child_process can spawn with merged env. Add child.applyEnv(env) when we
  // swap.
  const port = await findFreePort(AGENT_PORT_RANGE, registry.usedPorts())
  const started = await startAgent(bundlePath, port)

  registry.put({
    agentId,
    deploymentId,
    buildHash,
    env,
    port: started.port,
    url: started.url,
    close: started.close,
    startedAt: new Date(),
  })

  res.writeHead(204).end()
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

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
    })
    req.once('error', reject)
  })
}

server.listen(RUNTIME_PORT, () => {
  console.log(`[runtime] listening on http://127.0.0.1:${RUNTIME_PORT}`)
  console.log(`[runtime] agent ports: ${AGENT_PORT_RANGE.from}-${AGENT_PORT_RANGE.to}`)
  console.log(`[runtime] bundle cache: ${BUNDLE_CACHE}`)
  console.log(`[runtime] server url:   ${SERVER_URL}`)
})