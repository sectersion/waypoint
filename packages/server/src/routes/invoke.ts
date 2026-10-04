import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agents, invocations } from '../db/schema.js'
import { config } from '../waypoint-config.js'
import { forwardHttp } from '../util/forward.js'
import { httpError } from '../errors.js'

export async function invokeAgent(
  agentName: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const agent = (await db.select().from(agents).where(eq(agents.name, agentName)))[0]
  if (!agent) return httpError(res, 404, 'agent_not_found', `no agent with name '${agentName}'`)
  if (!agent.currentDeploymentId) {
    return httpError(res, 503, 'no_deployment', `agent '${agent.name}' has no active deployment`)
  }

  const invocationId = randomUUID()
  await db.insert(invocations).values({
    id: invocationId,
    agentId: agent.id,
    deploymentId: agent.currentDeploymentId,
    startedAt: new Date(),
  })

  try {
    await forwardHttp(req, res, `${config.runtimeUrl}/v1/internal/agents/${agent.name}/invoke`)
    await db.update(invocations).set({ endedAt: new Date() }).where(eq(invocations.id, invocationId))
  } catch (err) {
    await db.update(invocations).set({ endedAt: new Date(), statusCode: 502 }).where(eq(invocations.id, invocationId))
    if (!res.headersSent) httpError(res, 502, 'runtime_unavailable', String(err))
  }
}