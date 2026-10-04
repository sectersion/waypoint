import { build } from 'esbuild'
import { resolve as pathResolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { loadConfig } from '../waypoint-config.js'

export async function deployCommand(): Promise<void> {
  const cfg = loadConfig()
  const entrypoint = pathResolve(process.cwd(), cfg.entrypoint)

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

  const agent = await getOrCreateAgent(cfg.server, cfg.agent)

  const boundary = `----waypoint${randomUUID().replace(/-/g, '')}`
  const manifest = JSON.stringify({
    entrypoint:  cfg.entrypoint,
    nodeVersion: '20',
    env:         cfg.env,
    buildHash:   sha256,
  })
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="manifest"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${manifest}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="bundle"; filename="bundle.mjs"\r\n` +
    `Content-Type: application/javascript\r\n\r\n` +
    `${code}\r\n` +
    `--${boundary}--\r\n`

  console.log(`→ bundled ${(code.length / 1024).toFixed(1)} KB (sha256: ${sha256.slice(0, 12)}...)`)

  const deployRes = await fetch(`${cfg.server}/v1/agents/${agent.id}/deployments`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  })
  if (!deployRes.ok) throw new Error(`deploy failed (${deployRes.status}): ${await deployRes.text()}`)

  const { version } = (await deployRes.json()) as { deploymentId: string; version: number }
  console.log(`→ deployed ${cfg.agent} v${version} (${sha256.slice(0, 8)})`)
}

interface Agent { id: string; name: string }

async function getOrCreateAgent(server: string, name: string): Promise<Agent> {
  const listRes = await fetch(`${server}/v1/agents`)
  if (!listRes.ok) throw new Error(`list failed (${listRes.status})`)
  const agents = (await listRes.json()) as Agent[]
  const existing = agents.find((a) => a.name === name)
  if (existing) return existing

  const createRes = await fetch(`${server}/v1/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!createRes.ok) throw new Error(`create failed (${createRes.status}): ${await createRes.text()}`)
  return (await createRes.json()) as Agent
}