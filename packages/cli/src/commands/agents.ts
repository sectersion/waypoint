import { loadConfig } from '../waypoint-config.js'

export async function agentsCommand(subcmd: string): Promise<void> {
  if (subcmd !== 'list') throw new Error(`unknown agents subcommand: ${subcmd}`)

  const cfg = loadConfig()
  const res = await fetch(`${cfg.server}/v1/internal/agents`)
  if (!res.ok) throw new Error(`list failed (${res.status})`)

  const agents = (await res.json()) as Array<{
    agentId: string
    deploymentId: string
    port: number
    startedAt: string
  }>
  if (agents.length === 0) {
    console.log('no agents deployed')
    return
  }
  console.table(agents)
}