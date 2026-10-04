import { build } from 'esbuild'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { loadConfig } from '../waypoint-config.js'

export async function deployCommand(): Promise<void> {
  const cfg = loadConfig()
  const entrypoint = resolve(process.cwd(), cfg.entrypoint)

  const result = await build({
    entryPoints: [entrypoint],
    bundle:      true,
    platform:    'node',
    target:      'node20',
    format:      'esm',
    write:       false,
  })
  const out = result.outputFiles[0]
  if (!out) throw new Error('esbuild produced no output')

  const code = out.text
  const sha256 = createHash('sha256').update(code).digest('hex')
  const deploymentId = randomUUID()

  console.log(`→ bundled ${(code.length / 1024).toFixed(1)} KB (sha256: ${sha256.slice(0, 12)}...)`)

  const res = await fetch(`${cfg.server}/v1/internal/agents/${cfg.agent}/claim`, {
    method: 'POST',
    headers: {
      'X-Waypoint-Deployment-Id': deploymentId,
      'X-Waypoint-Build-Hash':   sha256,
      'Content-Type':             'application/javascript',
    },
    body: code,
  })
  if (!res.ok) throw new Error(`claim failed (${res.status}): ${await res.text()}`)

  const { port } = (await res.json()) as { port: number }
  console.log(`→ deployed ${cfg.agent} (${deploymentId.slice(0, 8)}) on port ${port}`)
}