import type { ServerResponse } from 'node:http'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agents, invocations, stateKv } from '../db/schema.js'
import { httpError } from '../errors.js'

export async function listInvocations(
  agentName: string,
  limit: number,
  res: ServerResponse,
): Promise<void> {
  const agent = (await db.select().from(agents).where(eq(agents.name, agentName)))[0]
  if (!agent) return httpError(res, 404, 'agent_not_found', `no agent with name '${agentName}'`)
  const rows = await db
    .select()
    .from(invocations)
    .where(eq(invocations.agentId, agent.id))
    .orderBy(desc(invocations.startedAt))
    .limit(limit)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(rows.map((r) => ({
    id: r.id,
    deploymentId: r.deploymentId,
    startedAt: r.startedAt.toISOString(),
    endedAt:   r.endedAt?.toISOString() ?? null,
    statusCode: r.statusCode ?? null,
  }))))
}

export async function listStateKv(
  agentName: string,
  res: ServerResponse,
): Promise<void> {
  const agent = (await db.select().from(agents).where(eq(agents.name, agentName)))[0]
  if (!agent) return httpError(res, 404, 'agent_not_found', `no agent with name '${agentName}'`)
  const rows = await db
    .select()
    .from(stateKv)
    .where(eq(stateKv.agentId, agent.id))
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(rows.map((r) => ({
    key:       r.key,
    value:     r.value,
    updatedAt: r.updatedAt.toISOString(),
  }))))
}