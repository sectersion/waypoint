import type { IncomingMessage, ServerResponse } from 'node:http'

export default async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    reply: 'hello from hello-agent',
    method: req.method,
    url:   req.url,
  }))
}