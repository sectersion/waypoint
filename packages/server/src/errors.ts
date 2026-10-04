import type { ServerResponse } from 'node:http'

export function httpError(res: ServerResponse, status: number, code: string, message: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { code, message } }))
}