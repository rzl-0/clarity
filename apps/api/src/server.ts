import { buildApp } from './app.js'

const app = await buildApp()

const port = parseInt(process.env.PORT ?? '3000', 10)
const host = process.env.HOST ?? '0.0.0.0'

await app.listen({ port, host })

const shutdown = async () => {
  await app.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
