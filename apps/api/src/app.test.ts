import { describe, it, expect } from 'vitest'
import { buildApp } from './app.js'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
