import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { handleStateRpc } from './state-server.js'

export type AgentHandle = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> | void

export type AgentExport = AgentHandle | { handle: AgentHandle }

export interface StartedAgent {
  url: string
  port: number
  stateUrl: string
  close: () => Promise<void>
}

export const STATE_PATH = '/__waypoint/state'

// ponytail: in-process dynamic import for MVP-0. v1.x swaps to child_process for tenant isolation.
export async function startAgent(bundlePath: string, port: number, agentUuid: string): Promise<StartedAgent> {
  const mod = (await import(pathToFileURL(bundlePath).href)) as { default: AgentExport }
  const agent = mod.default
  const handle: AgentHandle = typeof agent === 'function' ? agent : agent.handle

  const server = http.createServer((req, res) => {
    if (req.url === STATE_PATH && req.method === 'POST') {
      handleStateRpc(agentUuid, req, res)
      return
    }
    Promise.resolve(handle(req, res)).catch((err) => {
      console.error(`[agent] ${port} error:`, err)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'agent_error', message: String(err) }))
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    stateUrl: `http://127.0.0.1:${port}${STATE_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}