import http from 'node:http'
import type { IncomingMessage, ServerResponse, IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'

export function forwardHttp(
  req: IncomingMessage,
  res: ServerResponse,
  target: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(target)
    const opts: http.RequestOptions = {
      method: req.method,
      hostname: u.hostname,
      port: u.port,
      path: (u.pathname || '/') + u.search,
      headers: filterHeaders(req.headers),
    }
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers as OutgoingHttpHeaders)
      proxyRes.pipe(res)
    })
    proxyReq.once('error', reject)
    req.pipe(proxyReq)
    res.once('close', () => resolve())
  })
}

function filterHeaders(h: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {}
  for (const [k, v] of Object.entries(h)) {
    if (k.startsWith('x-waypoint-')) continue
    if (k === 'host' || k === 'connection' || k === 'content-length') continue
    if (v !== undefined) out[k] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}