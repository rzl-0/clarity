import { describe, it, expect } from 'vitest'

describe('config', () => {
  it('throws when DATABASE_URL is missing', async () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    await expect(import('../config.js')).rejects.toThrow()
    process.env.DATABASE_URL = original
  })
})
