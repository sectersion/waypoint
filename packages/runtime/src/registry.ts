export interface AgentRecord {
  agentId: string
  agentUuid: string
  deploymentId: string
  buildHash: string
  env: Record<string, string>
  port: number
  url: string
  stateUrl: string
  close: () => Promise<void>
  startedAt: Date
}

const agents = new Map<string, AgentRecord>()

export function put(rec: AgentRecord): void {
  const existing = agents.get(rec.agentId)
  if (existing) {
    existing.close().catch(() => undefined)
  }
  agents.set(rec.agentId, rec)
}

export function get(agentId: string): AgentRecord | undefined {
  return agents.get(agentId)
}

export function list(): AgentRecord[] {
  return Array.from(agents.values())
}

export function remove(agentId: string): boolean {
  const rec = agents.get(agentId)
  if (!rec) return false
  rec.close().catch(() => undefined)
  agents.delete(agentId)
  return true
}

export function usedPorts(): Set<number> {
  return new Set(Array.from(agents.values()).map((a) => a.port))
}