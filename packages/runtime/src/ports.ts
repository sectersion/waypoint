import net from 'node:net'

export type PortRange = { from: number; to: number }

export function parsePortRange(s: string): PortRange {
  const [fromStr, toStr] = s.split('-')
  const from = Number(fromStr)
  const to = Number(toStr)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to) {
    throw new Error(`bad port range: ${s}`)
  }
  return { from, to }
}

export async function findFreePort(range: PortRange, used: Set<number>): Promise<number> {
  for (let port = range.from; port <= range.to; port++) {
    if (used.has(port)) continue
    if (await tryListen(port)) return port
  }
  throw new Error(`no free port in ${range.from}-${range.to}`)
}

function tryListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => s.close(() => resolve(true)))
    s.listen(port, '127.0.0.1')
  })
}