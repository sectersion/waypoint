import { loadConfig } from '../waypoint-config.js'

export async function agentsCommand(subcmd: string): Promise<void> {
  if (subcmd !== 'list') throw new Error(`unknown agents subcommand: ${subcmd}`)

  const cfg = loadConfig()
  const res = await fetch(`${cfg.server}/v1/agents`)
  if (!res.ok) throw new Error(`list failed (${res.status})`)

  const agents = (await res.json()) as Array<{
    id: string
    name: string
    replicas: number
    currentDeploymentId: string | null
    createdAt: string
  }>
  if (agents.length === 0) {
    console.log('no agents')
    return
  }
  console.table(agents)
}