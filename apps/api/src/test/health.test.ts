import { describe, it, expect } from 'vitest'
import { getTestApp } from './helpers/app.js'

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
