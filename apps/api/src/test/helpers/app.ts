import { buildApp } from '../../app.js'
import type { FastifyInstance } from 'fastify'

let _app: FastifyInstance | null = null

export async function getTestApp(): Promise<FastifyInstance> {
  if (!_app) {
    _app = await buildApp()
    await _app.ready()
  }
  return _app
}
