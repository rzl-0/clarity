import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  CLAUDE_API_KEY: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:8081'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export const config = schema.parse(process.env)
export type Config = z.infer<typeof schema>
