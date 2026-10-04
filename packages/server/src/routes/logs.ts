import type { IncomingMessage, ServerResponse } from 'node:http'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { logs, agents } from '../db/schema.js'
import { httpError } from '../errors.js'

interface LogLine {
  ts?: string
  stream?: string
  line?: string
}

// ponytail: both endpoints key by deployment_id (UUID), not agent name. The CLI
// resolves agent name → current deployment id before calling.
export async function appendLogs(
  deploymentId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = (await readJson(req)) as { lines?: unknown } | null
  const lines = body?.lines
  if (!Array.isArray(lines)) {
    return httpError(res, 400, 'invalid_request', 'lines[] required')
  }
  const rows: { deploymentId: string; ts: Date; stream: string; line: string }[] = []
  for (const raw of lines) {
    const l = raw as LogLine
    if (typeof l.line !== 'string' || typeof l.stream !== 'string') continue
    rows.push({
      deploymentId,
      ts: l.ts ? new Date(l.ts) : new Date(),
      stream: l.stream,
      line: l.line,
    })
  }
  if (rows.length === 0) {
    res.writeHead(204).end()
    return
  }
  await db.insert(logs).values(rows)
  res.writeHead(204).end()
}

export async function tailLogs(
  deploymentId: string,
  limit: number,
  res: ServerResponse,
): Promise<void> {
  const rows = await db
    .select()
    .from(logs)
    .where(eq(logs.deploymentId, deploymentId))
    .orderBy(desc(logs.id))
    .limit(limit)
  // Return ascending so the caller can print top-to-bottom.
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(rows.reverse().map((r) => ({
    ts: r.ts.toISOString(),
    stream: r.stream,
    line: r.line,
  }))))
}

// ponytail: convenience for the CLI — resolves agent name → current
// deployment id, then tails. Separate from /v1/internal so the CLI
// doesn't have to know about the deployments table.
export async function tailAgentLogs(
  agentName: string,
  limit: number,
  res: ServerResponse,
): Promise<void> {
  const agent = (await db.select().from(agents).where(eq(agents.name, agentName)))[0]
  if (!agent) return httpError(res, 404, 'agent_not_found', `no agent with name '${agentName}'`)
  if (!agent.currentDeploymentId) {
    return httpError(res, 503, 'no_deployment', `agent '${agentName}' has no active deployment`)
  }
  return tailLogs(agent.currentDeploymentId, limit, res)
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
    })
    req.once('error', reject)
  })
}