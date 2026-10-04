import { loadConfig } from '../waypoint-config.js'

interface LogLine {
  ts: string
  stream: string
  line: string
}

// ponytail: MVP-0 is one-shot (no --follow). The user runs `waypoint logs`,
// reads, reruns. Add polling/SSE when the dashboard lands; it's not worth
// the stream-parse complexity now.
export async function logsCommand(name: string, limit: number): Promise<void> {
  const cfg = loadConfig()
  if (!cfg.agent) throw new Error('no agent in waypoint.json and WAYPOINT_AGENT unset')
  const agent = name ?? cfg.agent

  const url = new URL(`${cfg.server}/v1/agents/${encodeURIComponent(agent)}/logs`)
  url.searchParams.set('limit', String(limit))

  const res = await fetch(url)
  if (!res.ok) throw new Error(`logs failed (${res.status}): ${await res.text()}`)

  const lines = (await res.json()) as LogLine[]
  if (lines.length === 0) {
    console.log('(no logs yet)')
    return
  }
  for (const l of lines) {
    const t = l.ts.slice(11, 23)
    process.stdout.write(`${t} ${l.stream.padEnd(5)} ${l.line}\n`)
  }
}