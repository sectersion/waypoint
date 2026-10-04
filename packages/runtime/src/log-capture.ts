import type { IncomingMessage } from 'node:http'
import http from 'node:http'

// ponytail: in-process agent hosting means agent console.* calls share the
// runtime's console. Hook once at module load. Concurrency: every line is
// tagged with the currently-active deploymentId, which is fine for MVP-0
// single-request dev. With child_process v1.x swap, each agent gets its own
// stdout pipe and this becomes per-child capture.

interface BufferedLine {
  ts: string
  stream: string
  line: string
}

let activeDeploymentId: string | null = null
let buffer: BufferedLine[] = []
let flushTimer: NodeJS.Timeout | null = null

const FLUSH_MS = 500
const FLUSH_MAX = 100
const SERVER_URL = process.env.WAYPOINT_SERVER_URL ?? 'http://127.0.0.1:3000'

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

export function installLogCapture(): void {
  for (const m of METHODS) {
    const orig = console[m].bind(console)
    console[m] = (...args: unknown[]) => {
      capture(m, args)
      orig(...args)
    }
  }
}

function capture(stream: string, args: unknown[]): void {
  // ponytail: only capture when there's a deployment to tag the line with.
  // Runtime's own logs (startup, idle) pass through to stdout but never
  // land in the logs table.
  if (!activeDeploymentId) return
  const line = args.map(stringify).join(' ')
  buffer.push({ ts: new Date().toISOString(), stream, line })
  if (buffer.length >= FLUSH_MAX) {
    void flush()
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => { void flush() }, FLUSH_MS)
  }
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack ?? v.message
  try { return JSON.stringify(v) } catch { return String(v) }
}

export function setActiveDeployment(id: string | null): void {
  activeDeploymentId = id
}

async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (buffer.length === 0 || !activeDeploymentId) return
  const lines = buffer
  buffer = []
  const deploymentId = activeDeploymentId
  const body = JSON.stringify({ lines })
  try {
    await postJson(`/v1/internal/logs/${deploymentId}`, body)
  } catch {
    // ponytail: drop on network failure. Server is the persistent record;
    // re-delivering on retry is harder than it sounds (idempotency keys for
    // unordered batches). Add retry with a local on-disk queue when a real
    // outage scenario appears.
  }
}

// ponytail: setInterval keeps the last partial batch from sitting in memory
// until the next console call. Stops on unref so it doesn't block shutdown.
const interval = setInterval(() => { void flush() }, FLUSH_MS * 2)
interval.unref()

function postJson(path: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(SERVER_URL + path)
    const req = http.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      res.resume()
      res.once('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`log flush ${res.statusCode}`))
      })
    })
    req.once('error', reject)
    req.write(body)
    req.end()
  })
}

// ponytail: drain on shutdown so the last lines aren't lost.
export async function drainLogs(): Promise<void> {
  await flush()
}