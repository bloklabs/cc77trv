import http from 'node:http'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--') && all[index + 1] && !all[index + 1].startsWith('--')) pairs.push([value.slice(2), all[index + 1]])
  return pairs
}, []))

if (!args.host || args.base !== '/' || !process.env.VITE_XRAY) process.exit(2)

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('xray fixture')
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  process.stdout.write(`${JSON.stringify({ hostArg: args.host, portArg: args.port, url: `http://127.0.0.1:${address.port}/` })}\n`)
})

process.once('SIGTERM', () => server.close(() => process.exit(0)))
