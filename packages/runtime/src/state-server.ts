import type { IncomingMessage, ServerResponse } from 'node:http'
import { eq, and } from 'drizzle-orm'
import { db } from './db.js'
import { stateKv } from './state-schema.js'

export async function handleStateRpc(
  agentUuid: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.once('end', async () => {
    try {
      const op = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        op: 'get' | 'set' | 'delete'
        key: string
        value?: unknown
      }
      const result = await dispatch(agentUuid, op)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  })
  req.once('error', () => {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'stream_error' }))
    }
  })
}

async function dispatch(
  agentUuid: string,
  op: { op: 'get' | 'set' | 'delete'; key: string; value?: unknown },
): Promise<{ ok: true; value: unknown } | { ok: boolean; error?: string }> {
  if (op.op === 'get') {
    const row = (await db.select().from(stateKv).where(and(eq(stateKv.agentId, agentUuid), eq(stateKv.key, op.key))))[0]
    return row ? { ok: true, value: row.value } : { ok: true, value: null }
  }
  if (op.op === 'set') {
    await db.insert(stateKv).values({ agentId: agentUuid, key: op.key, value: op.value as never }).onConflictDoUpdate({
      target: [stateKv.agentId, stateKv.key],
      set: { value: op.value as never, updatedAt: new Date() },
    })
    return { ok: true, value: undefined }
  }
  if (op.op === 'delete') {
    await db.delete(stateKv).where(and(eq(stateKv.agentId, agentUuid), eq(stateKv.key, op.key)))
    return { ok: true, value: undefined }
  }
  return { ok: false, error: 'unknown_op' }
}