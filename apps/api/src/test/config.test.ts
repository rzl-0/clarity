import { describe, it, expect } from 'vitest'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  CLAUDE_API_KEY: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:8081'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

describe('config schema', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => schema.parse({ JWT_SECRET: 'this-is-a-32-character-test-secret', CLAUDE_API_KEY: 'test' }))
      .toThrow()
  })

  it('throws when JWT_SECRET is too short', () => {
    expect(() => schema.parse({ DATABASE_URL: 'postgresql://x:x@localhost/x', JWT_SECRET: 'short', CLAUDE_API_KEY: 'test' }))
      .toThrow()
  })

  it('parses valid env successfully', () => {
    const result = schema.parse({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/clarity',
      JWT_SECRET: 'this-is-a-32-character-test-secret',
      CLAUDE_API_KEY: 'test-key',
    })
    expect(result.PORT).toBe(3000)
    expect(result.NODE_ENV).toBe('development')
    expect(result.CORS_ORIGIN).toBe('http://localhost:8081')
  })
})
