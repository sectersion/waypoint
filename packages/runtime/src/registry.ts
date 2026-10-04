export interface AgentRecord {
  agentId: string
  deploymentId: string
  buildHash: string
  port: number
  url: string
  close: () => Promise<void>
  startedAt: Date
}

const agents = new Map<string, AgentRecord>()

export function put(rec: AgentRecord): void {
  const existing = agents.get(rec.agentId)
  if (existing) {
    existing.close().catch(() => {})
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
  rec.close().catch(() => {})
  agents.delete(agentId)
  return true
}

export function usedPorts(): Set<number> {
  return new Set(Array.from(agents.values()).map((a) => a.port))
}