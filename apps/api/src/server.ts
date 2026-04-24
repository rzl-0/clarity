import { buildApp } from './app.js'

const app = await buildApp()

await app.listen({ port: 3000, host: '0.0.0.0' })
