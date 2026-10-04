// ponytail: spec ships WAYPOINT_STATE_SOCKET as a Unix-domain socket path
// (line-delimited JSON). MVP-0 on Windows uses HTTP at WAYPOINT_STATE_URL
// (POST + JSON body) on the agent's own port at /__waypoint/state. The SDK
// doesn't know which transport the runtime uses — it just reads whichever
// env var is set. v1.x on Linux restores the Unix-socket transport; the
// SDK switches back to net.createConnection then.
let url: string | undefined

function resolveUrl(): string {
  if (url) return url
  url = process.env.WAYPOINT_STATE_URL ?? process.env.WAYPOINT_STATE_SOCKET
  if (!url) throw new Error('WAYPOINT_STATE_URL (or WAYPOINT_STATE_SOCKET) is not set')
  return url
}

export async function rpc<T>(op: object): Promise<T> {
  const res = await fetch(resolveUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(op),
  })
  if (!res.ok) throw new Error(`state rpc failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}