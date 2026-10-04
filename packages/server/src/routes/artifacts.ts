import type { ServerResponse } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import path from 'node:path'
import { db } from '../db/index.js'
import { deployments } from '../db/schema.js'
import { config } from '../waypoint-config.js'
import { httpError } from '../errors.js'

export async function serveArtifact(deploymentId: string, res: ServerResponse): Promise<void> {
  const dep = (await db.select().from(deployments).where(eq(deployments.id, deploymentId)))[0]
  if (!dep) return httpError(res, 404, 'deployment_not_found', `no deployment '${deploymentId}'`)
  const bundlePath = path.join(config.artifactsDir, dep.agentId, deploymentId, 'bundle.mjs')
  try {
    const stat = statSync(bundlePath)
    res.writeHead(200, {
      'content-type': 'application/javascript',
      'content-length': stat.size,
    })
    createReadStream(bundlePath).pipe(res)
  } catch {
    httpError(res, 404, 'bundle_not_found', 'bundle file missing on disk')
  }
}