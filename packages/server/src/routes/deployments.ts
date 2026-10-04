import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { eq, sql, and } from 'drizzle-orm'
import Busboy from 'busboy'
import { db } from '../db/index.js'
import { agents, deployments } from '../db/schema.js'
import { config } from '../waypoint-config.js'
import { runtimeClaim } from '../runtime-client.js'
import { httpError } from '../errors.js'

interface Manifest {
  entrypoint: string
  nodeVersion: string
  env: Record<string, string>
  buildHash: string
}

export async function createDeployment(
  agentId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const agent = (await db.select().from(agents).where(eq(agents.id, agentId)))[0]
  if (!agent) return httpError(res, 404, 'agent_not_found', `no agent with id '${agentId}'`)

  const contentType = req.headers['content-type']
  if (!contentType?.startsWith('multipart/form-data')) {
    return httpError(res, 400, 'invalid_content_type', 'multipart/form-data required')
  }

  const deploymentId = randomUUID()
  const bundleDir = path.join(config.artifactsDir, agentId, deploymentId)
  await mkdir(bundleDir, { recursive: true })
  const bundlePath = path.join(bundleDir, 'bundle.mjs')

  let manifest: Manifest | undefined
  const bundleChunks: Buffer[] = []

  const busboy = Busboy({ headers: req.headers })

  busboy.on('field', (name, value) => {
    if (name === 'manifest') {
      try { manifest = JSON.parse(value) as Manifest } catch { /* surfaced below */ }
    }
  })

  busboy.on('file', (name, stream) => {
    if (name === 'bundle') {
      stream.on('data', (c: Buffer) => bundleChunks.push(c))
    } else {
      stream.resume()
    }
  })

  await new Promise<void>((resolve, reject) => {
    busboy.on('finish', resolve)
    busboy.on('error', reject)
    req.on('error', reject)
    req.pipe(busboy)
  })

  if (!manifest) return httpError(res, 400, 'missing_manifest', 'manifest field required')
  if (bundleChunks.length === 0) return httpError(res, 400, 'missing_bundle', 'bundle file required')

  const bundleBuf = Buffer.concat(bundleChunks)
  const bundleSha = createHash('sha256').update(bundleBuf).digest('hex')
  if (manifest.buildHash !== bundleSha) {
    return httpError(res, 400, 'hash_mismatch', `bundle sha256 ${bundleSha} != manifest ${manifest.buildHash}`)
  }

  await writeFile(bundlePath, bundleBuf)

  const versionRows = await db
    .select({ max: sql<number>`COALESCE(MAX(${deployments.version}), 0)` })
    .from(deployments)
    .where(eq(deployments.agentId, agentId))
  const version = (versionRows[0]?.max ?? 0) + 1

  await db.insert(deployments).values({
    id: deploymentId,
    agentId,
    version,
    buildHash: manifest.buildHash,
    env: manifest.env,
    status: 'pending',
  })

  await db.update(agents)
    .set({ currentDeploymentId: deploymentId })
    .where(eq(agents.id, agentId))

  await db.update(deployments)
    .set({ status: 'superseded' })
    .where(and(eq(deployments.agentId, agentId), eq(deployments.status, 'active')))

  try {
    await runtimeClaim(agent.name, deploymentId, `/v1/internal/artifacts/${deploymentId}/bundle`, manifest.env)
    await db.update(deployments).set({ status: 'active' }).where(eq(deployments.id, deploymentId))
  } catch (err) {
    await db.update(deployments).set({ status: 'failed' }).where(eq(deployments.id, deploymentId))
    return httpError(res, 502, 'runtime_claim_failed', String(err))
  }

  res.writeHead(201, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ deploymentId, version }))
}