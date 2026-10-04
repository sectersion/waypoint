import { waypointMastraTools } from '@sardonic-labs/waypoint-sdk'
import type { IncomingMessage, ServerResponse } from 'node:http'

const tools = waypointMastraTools()

export default async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const prev = await tools.stateGet.execute({ key: 'count' })
  const next = (typeof prev === 'number' ? prev : 0) + 1
  await tools.stateSet.execute({ key: 'count', value: next })

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    reply: `call #${next}`,
    method: req.method,
    url:   req.url,
  }))
}