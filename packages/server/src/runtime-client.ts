import { config } from './waypoint-config.js'

export async function runtimeClaim(
  agentName: string,
  deploymentId: string,
  buildUrl: string,
  env: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${config.runtimeUrl}/v1/internal/agents/${agentName}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deploymentId, buildUrl, env }),
  })
  if (!res.ok) throw new Error(`runtime claim failed (${res.status}): ${await res.text()}`)
}

export async function runtimeRelease(agentName: string): Promise<void> {
  await fetch(`${config.runtimeUrl}/v1/internal/agents/${agentName}/release`, { method: 'DELETE' })
}

export async function runtimeHealth(): Promise<{ ok: boolean; agents: number }> {
  try {
    const res = await fetch(`${config.runtimeUrl}/health`)
    if (!res.ok) return { ok: false, agents: 0 }
    const data = (await res.json()) as { ok: boolean; agents: number }
    return { ok: data.ok, agents: data.agents }
  } catch {
    return { ok: false, agents: 0 }
  }
}