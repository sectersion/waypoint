import type { IncomingMessage, ServerResponse } from 'node:http'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agents, deployments } from '../db/schema.js'
import { httpError } from '../errors.js'
import { runtimeRelease } from '../runtime-client.js'

export async function listAgents(res: ServerResponse): Promise<void> {
  const rows = await db.select().from(agents)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(rows))
}

export async function createAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJson(req)) as { name?: unknown } | null
  const name = body?.name
  if (typeof name !== 'string' || name.length === 0) {
    return httpError(res, 400, 'invalid_request', 'name is required')
  }
  const rows = await db.select().from(agents).where(eq(agents.name, name))
  if (rows[0]) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(rows[0]))
    return
  }
  const inserted = await db.insert(agents).values({ name }).returning()
  res.writeHead(201, { 'content-type': 'application/json' })
  res.end(JSON.stringify(inserted[0]))
}

export async function getAgent(id: string, res: ServerResponse): Promise<void> {
  const row = (await db.select().from(agents).where(eq(agents.id, id)))[0]
  if (!row) return httpError(res, 404, 'agent_not_found', `no agent with id '${id}'`)
  const last = await db
    .select()
    .from(deployments)
    .where(eq(deployments.agentId, id))
    .orderBy(desc(deployments.version))
    .limit(10)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ...row, deployments: last }))
}

export async function deleteAgent(id: string, res: ServerResponse): Promise<void> {
  const row = (await db.select().from(agents).where(eq(agents.id, id)))[0]
  if (!row) return httpError(res, 404, 'agent_not_found', `no agent with id '${id}'`)
  await db.delete(agents).where(eq(agents.id, id))
  await runtimeRelease(row.name).catch(() => undefined)
  res.writeHead(204).end()
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