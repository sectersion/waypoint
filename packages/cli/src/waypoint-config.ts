import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WaypointConfig {
  server: string
  agent: string
  entrypoint: string
  env: Record<string, string>
}

export function loadConfig(): WaypointConfig {
  const configPath = join(process.cwd(), 'waypoint.json')
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    throw new Error(`no waypoint.json found in ${process.cwd()}`)
  }
  const parsed = JSON.parse(raw) as Partial<WaypointConfig>
  if (!parsed.server || !parsed.agent || !parsed.entrypoint) {
    throw new Error(`waypoint.json missing required fields: server, agent, entrypoint`)
  }
  return {
    server:     process.env.WAYPOINT_SERVER ?? parsed.server,
    agent:      process.env.WAYPOINT_AGENT ?? parsed.agent,
    entrypoint: parsed.entrypoint,
    env:        parsed.env ?? {},
  }
}