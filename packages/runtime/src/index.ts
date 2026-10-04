import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 3030)

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'runtime' }))
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`[runtime] listening on http://127.0.0.1:${PORT}`)
})