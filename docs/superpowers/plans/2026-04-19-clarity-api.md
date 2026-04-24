# Clarity API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Clarity REST API — a Fastify v5 TypeScript backend with JWT auth, Drizzle ORM, and full CRUD for expenses, budgets, and subscriptions.

**Architecture:** Custom Fastify server owns all business logic. Client never touches Supabase directly — all DB access goes through API routes. Auth is hand-rolled: argon2 password hashing, access token (JWT/15min via `jose`), refresh token stored as a hash in Postgres. User isolation is enforced at the query layer by filtering every query with `userId` from the JWT payload.

**Tech Stack:** Node.js 22, TypeScript 5, Fastify v5, Drizzle ORM, Zod, jose, argon2, Vitest, Docker, GitHub Actions. Database: Supabase Postgres (production) + local Postgres via Docker (development/test).

---

## File Map

```
clarity/                          ← monorepo root
├── package.json                  ← npm workspaces
├── .env.example
├── docker-compose.yml            ← api + postgres (local dev)
├── .github/
│   └── workflows/ci.yml
└── apps/
    └── api/
        ├── package.json
        ├── tsconfig.json
        ├── drizzle.config.ts
        ├── vitest.config.ts
        ├── Dockerfile
        └── src/
            ├── server.ts         ← entry point (starts HTTP server)
            ├── app.ts            ← Fastify factory (used by tests too)
            ├── config.ts         ← Zod-validated env vars
            ├── plugins/
            │   ├── auth.ts       ← decorates fastify with `authenticate` hook
            │   └── swagger.ts    ← Swagger/OpenAPI setup
            ├── routes/
            │   ├── auth.ts       ← /auth/register, login, refresh, logout
            │   ├── categories.ts ← /categories CRUD
            │   ├── expenses.ts   ← /expenses CRUD + /expenses/scan
            │   ├── budgets.ts    ← /budgets CRUD + /:id/progress
            │   ├── subscriptions.ts ← /subscriptions CRUD + /:id/log
            │   ├── dashboard.ts  ← /dashboard aggregated stats
            │   └── rates.ts      ← /rates exchange rate
            ├── services/
            │   ├── auth.service.ts     ← argon2, jose, token storage
            │   ├── exchange.service.ts ← rate fetch + 24h in-memory cache
            │   └── claude.service.ts   ← receipt scanning via Claude Vision
            ├── db/
            │   ├── index.ts      ← Drizzle client singleton
            │   ├── schema.ts     ← all table definitions
            │   └── migrate.ts    ← migration runner script
            └── test/
                ├── helpers/
                │   ├── app.ts    ← build test Fastify instance
                │   └── db.ts     ← truncate tables between tests
                ├── auth.test.ts
                ├── categories.test.ts
                ├── expenses.test.ts
                ├── budgets.test.ts
                ├── subscriptions.test.ts
                └── dashboard.test.ts
```

---

### Task 1: Monorepo scaffold + Fastify hello world

**Files:**
- Create: `package.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`

- [ ] **Step 1: Create the monorepo root**

```bash
mkdir -p clarity/apps/api/src
cd clarity
```

Create `package.json`:
```json
{
  "name": "clarity",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev:api": "npm run dev --workspace=apps/api",
    "test:api": "npm run test --workspace=apps/api",
    "build:api": "npm run build --workspace=apps/api"
  }
}
```

- [ ] **Step 2: Create `apps/api/package.json`**

```json
{
  "name": "@clarity/api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "@fastify/cors": "^10.0.0",
    "@fastify/multipart": "^9.0.0",
    "@fastify/swagger": "^9.0.0",
    "@fastify/swagger-ui": "^5.0.0",
    "argon2": "^0.41.0",
    "drizzle-orm": "^0.38.0",
    "fastify": "^5.0.0",
    "fastify-plugin": "^5.0.0",
    "jose": "^5.0.0",
    "pg": "^8.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/pg": "^8.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "drizzle-kit": "^0.29.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create `apps/api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `apps/api/src/app.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
```

- [ ] **Step 5: Create `apps/api/src/server.ts`**

```typescript
import { buildApp } from './app.js'

const app = await buildApp()

await app.listen({ port: 3000, host: '0.0.0.0' })
```

- [ ] **Step 6: Install dependencies and verify server starts**

```bash
cd clarity
npm install
npm run dev:api
```

Expected: Fastify logs `Server listening at http://0.0.0.0:3000`

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "feat: monorepo scaffold + Fastify hello world"
```

---

### Task 2: Config — Zod-validated environment variables

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `.env.example`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/test/config.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'

describe('config', () => {
  it('throws when DATABASE_URL is missing', async () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    await expect(import('../config.js')).rejects.toThrow()
    process.env.DATABASE_URL = original
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run src/test/config.test.ts
```

Expected: FAIL — `config.js` does not exist yet.

- [ ] **Step 3: Create `apps/api/src/config.ts`**

```typescript
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
```

- [ ] **Step 4: Create `.env.example` at repo root**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clarity
JWT_SECRET=change-me-to-a-random-32-char-string-minimum
CLAUDE_API_KEY=sk-ant-...
CORS_ORIGIN=http://localhost:8081
PORT=3000
NODE_ENV=development
```

Copy to `.env` and fill in real values:
```bash
cp .env.example .env
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && npx vitest run src/test/config.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/test/config.test.ts .env.example
git commit -m "feat: Zod-validated config from environment variables"
```

---

### Task 3: Database — Drizzle schema + migrations

**Files:**
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/index.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/drizzle.config.ts`

- [ ] **Step 1: Create `apps/api/drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit'
import { config } from './src/config.js'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: config.DATABASE_URL },
})
```

- [ ] **Step 2: Create `apps/api/src/db/schema.ts`**

```typescript
import {
  pgTable, uuid, text, numeric, integer,
  boolean, date, timestamp, unique,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name:         text('name').notNull(),
  currency:     text('currency').notNull().default('CLP'),
  locale:       text('locale').notNull().default('es'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
})

export const refreshTokens = pgTable('refresh_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const categories = pgTable('categories', {
  id:       uuid('id').primaryKey().defaultRandom(),
  userId:   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:     text('name').notNull(),
  icon:     text('icon').notNull().default('tag'),
  color:    text('color').notNull().default('#7c6af7'),
})

export const expenses = pgTable('expenses', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount:      numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency:    text('currency').notNull().default('CLP'),
  categoryId:  uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  date:        date('date').notNull(),
  receiptUrl:  text('receipt_url'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

export const budgets = pgTable('budgets', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
  amount:     numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency:   text('currency').notNull().default('CLP'),
  period:     text('period').notNull().default('monthly'),   // monthly | quarterly | yearly
  alertPct:   integer('alert_pct').notNull().default(80),
  startsAt:   date('starts_at').notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  amount:      numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency:    text('currency').notNull().default('CLP'),
  renewalDate: date('renewal_date').notNull(),
  notifyDays:  integer('notify_days').notNull().default(3),
  active:      boolean('active').notNull().default(true),
  notes:       text('notes'),
})
```

- [ ] **Step 3: Create `apps/api/src/db/index.ts`**

```typescript
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { config } from '../config.js'
import * as schema from './schema.js'

const pool = new Pool({ connectionString: config.DATABASE_URL })

export const db = drizzle(pool, { schema })
export type DB = typeof db
```

- [ ] **Step 4: Create `apps/api/src/db/migrate.ts`**

```typescript
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './index.js'

await migrate(db, { migrationsFolder: './src/db/migrations' })
console.log('Migrations complete')
process.exit(0)
```

- [ ] **Step 5: Start local Postgres and run first migration**

You need a local Postgres running. Use Docker:
```bash
docker run -d \
  --name clarity-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=clarity \
  -p 5432:5432 \
  postgres:16
```

Generate and run the migration:
```bash
cd apps/api
npm run db:generate
npm run db:migrate
```

Expected: `Migrations complete`

- [ ] **Step 6: Verify tables exist**

```bash
docker exec -it clarity-db psql -U postgres -d clarity -c "\dt"
```

Expected: Lists `users`, `refresh_tokens`, `categories`, `expenses`, `budgets`, `subscriptions`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/ apps/api/drizzle.config.ts
git commit -m "feat: Drizzle schema and initial migration"
```

---

### Task 4: Vitest + test infrastructure

**Files:**
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/test/helpers/app.ts`
- Create: `apps/api/src/test/helpers/db.ts`

- [ ] **Step 1: Create `apps/api/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/helpers/db.ts'],
    poolOptions: {
      forks: { singleFork: true },  // one DB connection across all tests
    },
  },
})
```

- [ ] **Step 2: Create `apps/api/src/test/helpers/db.ts`**

```typescript
import { afterEach } from 'vitest'
import { db } from '../../db/index.js'
import {
  expenses, budgets, subscriptions,
  categories, refreshTokens, users,
} from '../../db/schema.js'

// Truncate all tables in dependency order after each test
afterEach(async () => {
  await db.delete(expenses)
  await db.delete(subscriptions)
  await db.delete(budgets)
  await db.delete(categories)
  await db.delete(refreshTokens)
  await db.delete(users)
})
```

- [ ] **Step 3: Create `apps/api/src/test/helpers/app.ts`**

```typescript
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
```

- [ ] **Step 4: Write a smoke test to verify the setup works**

Create `apps/api/src/test/health.test.ts`:
```typescript
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
```

- [ ] **Step 5: Add `TEST_DATABASE_URL` to `.env` and run test**

Add to `.env`:
```
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clarity_test
```

Create the test database:
```bash
docker exec -it clarity-db psql -U postgres -c "CREATE DATABASE clarity_test;"
```

Run migrations on test DB:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clarity_test npm run db:migrate --workspace=apps/api
```

Run the test:
```bash
npm run test:api
```

Expected: PASS — 1 test passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/vitest.config.ts apps/api/src/test/
git commit -m "feat: Vitest setup with test DB helpers"
```

---

### Task 5: Auth service — argon2 + jose

**Files:**
- Create: `apps/api/src/services/auth.service.ts`
- Create: `apps/api/src/test/auth.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/test/auth.service.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  hashPassword, verifyPassword,
  signAccessToken, verifyAccessToken,
  generateRefreshToken, hashToken,
} from '../services/auth.service.js'

describe('hashPassword / verifyPassword', () => {
  it('hashes a password and verifies it correctly', async () => {
    const hash = await hashPassword('secret123')
    expect(hash).not.toBe('secret123')
    await expect(verifyPassword('secret123', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('secret123')
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false)
  })
})

describe('signAccessToken / verifyAccessToken', () => {
  it('signs and verifies a token with userId', async () => {
    const userId = 'user-123'
    const token = await signAccessToken(userId)
    const payload = await verifyAccessToken(token)
    expect(payload.sub).toBe(userId)
  })

  it('throws on an invalid token', async () => {
    await expect(verifyAccessToken('not.a.token')).rejects.toThrow()
  })
})

describe('generateRefreshToken / hashToken', () => {
  it('generates a 64-char hex token', () => {
    const token = generateRefreshToken()
    expect(token).toHaveLength(128)  // 64 bytes = 128 hex chars
  })

  it('hashes consistently (same input = same output)', () => {
    const token = 'abc'
    expect(hashToken(token)).toBe(hashToken(token))
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:api -- auth.service
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/services/auth.service.ts`**

```typescript
import * as argon2 from 'argon2'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const secret = new TextEncoder().encode(config.JWT_SECRET)

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password)
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret)
}

export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret)
  return payload
}

export function generateRefreshToken(): string {
  return randomBytes(64).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:api -- auth.service
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth.service.ts apps/api/src/test/auth.service.test.ts
git commit -m "feat: auth service — argon2 password hashing and jose JWT"
```

---

### Task 6: Auth routes — register, login, refresh, logout

**Files:**
- Create: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/test/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/test/auth.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { getTestApp } from './helpers/app.js'

const base = '/auth'
const user = { email: 'test@example.com', password: 'password123', name: 'Test User' }

describe('POST /auth/register', () => {
  it('creates a user and returns accessToken', async () => {
    const app = await getTestApp()
    const res = await app.inject({
      method: 'POST', url: `${base}/register`, payload: user,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.accessToken).toBeDefined()
    expect(body.user.email).toBe(user.email)
    expect(body.user.passwordHash).toBeUndefined()
  })

  it('returns 409 when email already exists', async () => {
    const app = await getTestApp()
    await app.inject({ method: 'POST', url: `${base}/register`, payload: user })
    const res = await app.inject({
      method: 'POST', url: `${base}/register`, payload: user,
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('POST /auth/login', () => {
  it('returns accessToken on valid credentials', async () => {
    const app = await getTestApp()
    await app.inject({ method: 'POST', url: `${base}/register`, payload: user })
    const res = await app.inject({
      method: 'POST', url: `${base}/login`,
      payload: { email: user.email, password: user.password },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeDefined()
    expect(res.cookies.find(c => c.name === 'refreshToken')).toBeDefined()
  })

  it('returns 401 on wrong password', async () => {
    const app = await getTestApp()
    await app.inject({ method: 'POST', url: `${base}/register`, payload: user })
    const res = await app.inject({
      method: 'POST', url: `${base}/login`,
      payload: { email: user.email, password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /auth/refresh', () => {
  it('returns a new accessToken using the refresh cookie', async () => {
    const app = await getTestApp()
    await app.inject({ method: 'POST', url: `${base}/register`, payload: user })
    const loginRes = await app.inject({
      method: 'POST', url: `${base}/login`,
      payload: { email: user.email, password: user.password },
    })
    const cookie = loginRes.cookies.find(c => c.name === 'refreshToken')!
    const res = await app.inject({
      method: 'POST', url: `${base}/refresh`,
      cookies: { refreshToken: cookie.value },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeDefined()
  })
})

describe('POST /auth/logout', () => {
  it('revokes the refresh token', async () => {
    const app = await getTestApp()
    await app.inject({ method: 'POST', url: `${base}/register`, payload: user })
    const loginRes = await app.inject({
      method: 'POST', url: `${base}/login`,
      payload: { email: user.email, password: user.password },
    })
    const cookie = loginRes.cookies.find(c => c.name === 'refreshToken')!
    await app.inject({
      method: 'POST', url: `${base}/logout`,
      cookies: { refreshToken: cookie.value },
    })
    // refresh after logout should fail
    const res = await app.inject({
      method: 'POST', url: `${base}/refresh`,
      cookies: { refreshToken: cookie.value },
    })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:api -- src/test/auth.test.ts
```

Expected: FAIL — routes not registered.

- [ ] **Step 3: Create `apps/api/src/routes/auth.ts`**

```typescript
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { users, refreshTokens } from '../db/schema.js'
import {
  hashPassword, verifyPassword,
  signAccessToken,
  generateRefreshToken, hashToken,
} from '../services/auth.service.js'
import { eq, and, gt, isNull } from 'drizzle-orm'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body)

    const existing = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    })
    if (existing) return reply.status(409).send({ error: 'Email already in use' })

    const passwordHash = await hashPassword(body.password)
    const [user] = await db.insert(users)
      .values({ email: body.email, passwordHash, name: body.name })
      .returning({ id: users.id, email: users.email, name: users.name, currency: users.currency, locale: users.locale })

    const accessToken = await signAccessToken(user.id)

    return reply.status(201).send({ accessToken, user })
  })

  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)

    const user = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    })
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' })

    const valid = await verifyPassword(body.password, user.passwordHash)
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' })

    const accessToken = await signAccessToken(user.id)

    const rawToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt,
    })

    reply.setCookie('refreshToken', rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      expires: expiresAt,
    })

    const { passwordHash: _, ...safeUser } = user
    return reply.send({ accessToken, user: safeUser })
  })

  fastify.post('/auth/refresh', async (request, reply) => {
    const rawToken = (request.cookies as Record<string, string>)['refreshToken']
    if (!rawToken) return reply.status(401).send({ error: 'No refresh token' })

    const tokenHash = hashToken(rawToken)
    const record = await db.query.refreshTokens.findFirst({
      where: and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    })
    if (!record) return reply.status(401).send({ error: 'Invalid or expired token' })

    // Rotate: revoke old, issue new
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, record.id))

    const newRaw = generateRefreshToken()
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)
    await db.insert(refreshTokens).values({
      userId: record.userId,
      tokenHash: hashToken(newRaw),
      expiresAt,
    })

    reply.setCookie('refreshToken', newRaw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      expires: expiresAt,
    })

    const accessToken = await signAccessToken(record.userId)
    return reply.send({ accessToken })
  })

  fastify.post('/auth/logout', async (request, reply) => {
    const rawToken = (request.cookies as Record<string, string>)['refreshToken']
    if (rawToken) {
      await db.update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashToken(rawToken)))
    }
    reply.clearCookie('refreshToken', { path: '/auth/refresh' })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Add cookie support and register routes in `apps/api/src/app.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { authRoutes } from './routes/auth.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie)
  await app.register(authRoutes)

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
```

Also install the cookie plugin:
```bash
npm install @fastify/cookie --workspace=apps/api
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:api -- src/test/auth.test.ts
```

Expected: PASS — 6 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/src/app.ts apps/api/src/test/auth.test.ts
git commit -m "feat: auth routes — register, login, refresh token rotation, logout"
```

---

### Task 7: Auth plugin — protect routes with JWT

**Files:**
- Create: `apps/api/src/plugins/auth.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/test/auth.test.ts`:
```typescript
describe('Protected route (preHandler)', () => {
  it('returns 401 when no Authorization header', async () => {
    const app = await getTestApp()
    const res = await app.inject({ method: 'GET', url: '/expenses' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 when Authorization header is valid', async () => {
    const app = await getTestApp()
    const reg = await app.inject({
      method: 'POST', url: '/auth/register', payload: user,
    })
    const { accessToken } = reg.json()
    const res = await app.inject({
      method: 'GET', url: '/expenses',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:api -- src/test/auth.test.ts
```

Expected: FAIL — `/expenses` returns 404.

- [ ] **Step 3: Create `apps/api/src/plugins/auth.ts`**

```typescript
import fp from 'fastify-plugin'
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '../services/auth.service.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    userId: string
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('userId', '')

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' })
    }
    const token = header.slice(7)
    try {
      const payload = await verifyAccessToken(token)
      request.userId = payload.sub as string
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' })
    }
  })
}

export default fp(authPlugin)
```

- [ ] **Step 4: Create a minimal expenses route stub and register the plugin in `app.ts`**

Create `apps/api/src/routes/expenses.ts` (stub for now):
```typescript
import { FastifyPluginAsync } from 'fastify'

export const expenseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/expenses', { onRequest: [fastify.authenticate] }, async (request) => {
    return { expenses: [], userId: request.userId }
  })
}
```

Update `apps/api/src/app.ts`:
```typescript
import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import authPlugin from './plugins/auth.js'
import { authRoutes } from './routes/auth.js'
import { expenseRoutes } from './routes/expenses.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  await app.register(cookie)
  await app.register(authPlugin)
  await app.register(authRoutes)
  await app.register(expenseRoutes)

  app.get('/health', async () => ({ status: 'ok' }))

  return app
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:api -- src/test/auth.test.ts
```

Expected: PASS — all 8 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/plugins/auth.ts apps/api/src/routes/expenses.ts apps/api/src/app.ts
git commit -m "feat: JWT auth plugin — decorates fastify with authenticate hook"
```

---

### Task 8: Categories routes

**Files:**
- Modify: `apps/api/src/routes/expenses.ts` → replace with full CRUD
- Create: `apps/api/src/routes/categories.ts`
- Create: `apps/api/src/test/categories.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/test/categories.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getTestApp } from './helpers/app.js'

const user = { email: 'cat@example.com', password: 'password123', name: 'Cat User' }
let token: string

beforeEach(async () => {
  const app = await getTestApp()
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: user })
  token = res.json().accessToken
})

async function authInject(method: string, url: string, payload?: object) {
  const app = await getTestApp()
  return app.inject({
    method: method as any, url,
    payload,
    headers: { Authorization: `Bearer ${token}` },
  })
}

describe('POST /categories', () => {
  it('creates a category', async () => {
    const res = await authInject('POST', '/categories', { name: 'Food', icon: 'fork', color: '#7c6af7' })
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('Food')
  })
})

describe('GET /categories', () => {
  it('returns only the user\'s categories', async () => {
    await authInject('POST', '/categories', { name: 'Food', icon: 'fork', color: '#7c6af7' })
    await authInject('POST', '/categories', { name: 'Transport', icon: 'car', color: '#4ecdc4' })
    const res = await authInject('GET', '/categories')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
  })
})

describe('PUT /categories/:id', () => {
  it('updates a category', async () => {
    const create = await authInject('POST', '/categories', { name: 'Food', icon: 'fork', color: '#7c6af7' })
    const id = create.json().id
    const res = await authInject('PUT', `/categories/${id}`, { name: 'Groceries' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Groceries')
  })

  it('returns 404 for another user\'s category', async () => {
    const create = await authInject('POST', '/categories', { name: 'Food', icon: 'fork', color: '#7c6af7' })
    const id = create.json().id

    // register second user
    const app = await getTestApp()
    const reg2 = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'other@example.com', password: 'password123', name: 'Other' } })
    const token2 = reg2.json().accessToken

    const res = await app.inject({
      method: 'PUT', url: `/categories/${id}`,
      payload: { name: 'Hacked' },
      headers: { Authorization: `Bearer ${token2}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /categories/:id', () => {
  it('deletes a category', async () => {
    const create = await authInject('POST', '/categories', { name: 'Food', icon: 'fork', color: '#7c6af7' })
    const id = create.json().id
    const res = await authInject('DELETE', `/categories/${id}`)
    expect(res.statusCode).toBe(200)
    const list = await authInject('GET', '/categories')
    expect(list.json()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:api -- src/test/categories.test.ts
```

Expected: FAIL — routes not found.

- [ ] **Step 3: Create `apps/api/src/routes/categories.ts`**

```typescript
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { categories } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const createSchema = z.object({
  name: z.string().min(1),
  icon: z.string().default('tag'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7c6af7'),
})

const updateSchema = createSchema.partial()

export const categoryRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  fastify.get('/categories', auth, async (request) => {
    return db.select().from(categories)
      .where(eq(categories.userId, request.userId))
  })

  fastify.post('/categories', auth, async (request, reply) => {
    const body = createSchema.parse(request.body)
    const [cat] = await db.insert(categories)
      .values({ ...body, userId: request.userId })
      .returning()
    return reply.status(201).send(cat)
  })

  fastify.put('/categories/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateSchema.parse(request.body)
    const [cat] = await db.update(categories)
      .set(body)
      .where(and(eq(categories.id, id), eq(categories.userId, request.userId)))
      .returning()
    if (!cat) return reply.status(404).send({ error: 'Not found' })
    return cat
  })

  fastify.delete('/categories/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [cat] = await db.delete(categories)
      .where(and(eq(categories.id, id), eq(categories.userId, request.userId)))
      .returning()
    if (!cat) return reply.status(404).send({ error: 'Not found' })
    return { ok: true }
  })
}
```

- [ ] **Step 4: Register route in `app.ts`**

```typescript
// add to imports
import { categoryRoutes } from './routes/categories.js'

// add inside buildApp(), after expenseRoutes
await app.register(categoryRoutes)
```

- [ ] **Step 5: Run tests**

```bash
npm run test:api -- src/test/categories.test.ts
```

Expected: PASS — 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/categories.ts apps/api/src/test/categories.test.ts apps/api/src/app.ts
git commit -m "feat: categories CRUD — user-scoped create, list, update, delete"
```

---

### Task 9: Expenses routes — full CRUD

**Files:**
- Modify: `apps/api/src/routes/expenses.ts` (replace stub)
- Create: `apps/api/src/test/expenses.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/test/expenses.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getTestApp } from './helpers/app.js'

const user = { email: 'exp@example.com', password: 'password123', name: 'Exp User' }
let token: string

beforeEach(async () => {
  const app = await getTestApp()
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: user })
  token = res.json().accessToken
})

async function authInject(method: string, url: string, payload?: object) {
  const app = await getTestApp()
  return app.inject({
    method: method as any, url, payload,
    headers: { Authorization: `Bearer ${token}` },
  })
}

const expensePayload = {
  amount: '3500',
  currency: 'CLP',
  description: 'Coffee',
  date: '2026-04-19',
}

describe('POST /expenses', () => {
  it('creates an expense', async () => {
    const res = await authInject('POST', '/expenses', expensePayload)
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.description).toBe('Coffee')
    expect(body.amount).toBe('3500.00')
  })
})

describe('GET /expenses', () => {
  it('returns paginated user expenses', async () => {
    await authInject('POST', '/expenses', expensePayload)
    await authInject('POST', '/expenses', { ...expensePayload, description: 'Lunch' })
    const res = await authInject('GET', '/expenses?limit=10&page=1')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('filters by currency', async () => {
    await authInject('POST', '/expenses', expensePayload)
    await authInject('POST', '/expenses', { ...expensePayload, currency: 'USD', amount: '10' })
    const res = await authInject('GET', '/expenses?currency=USD')
    expect(res.json().data).toHaveLength(1)
  })
})

describe('GET /expenses/:id', () => {
  it('returns the expense', async () => {
    const create = await authInject('POST', '/expenses', expensePayload)
    const { id } = create.json()
    const res = await authInject('GET', `/expenses/${id}`)
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(id)
  })

  it('returns 404 for another user\'s expense', async () => {
    const create = await authInject('POST', '/expenses', expensePayload)
    const { id } = create.json()
    const app = await getTestApp()
    const reg2 = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'other2@example.com', password: 'password123', name: 'Other' } })
    const res = await app.inject({
      method: 'GET', url: `/expenses/${id}`,
      headers: { Authorization: `Bearer ${reg2.json().accessToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /expenses/:id', () => {
  it('updates description', async () => {
    const create = await authInject('POST', '/expenses', expensePayload)
    const { id } = create.json()
    const res = await authInject('PUT', `/expenses/${id}`, { description: 'Espresso' })
    expect(res.json().description).toBe('Espresso')
  })
})

describe('DELETE /expenses/:id', () => {
  it('deletes the expense', async () => {
    const create = await authInject('POST', '/expenses', expensePayload)
    const { id } = create.json()
    await authInject('DELETE', `/expenses/${id}`)
    const res = await authInject('GET', `/expenses/${id}`)
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:api -- src/test/expenses.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace `apps/api/src/routes/expenses.ts`**

```typescript
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { expenses } from '../db/schema.js'
import { eq, and, sql, count } from 'drizzle-orm'

const createSchema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.enum(['CLP', 'USD']).default('CLP'),
  categoryId: z.string().uuid().optional(),
  description: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const updateSchema = createSchema.partial()

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  currency: z.enum(['CLP', 'USD']).optional(),
  categoryId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const expenseRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  fastify.get('/expenses', auth, async (request) => {
    const query = listQuerySchema.parse(request.query)
    const offset = (query.page - 1) * query.limit
    const where = and(
      eq(expenses.userId, request.userId),
      query.currency ? eq(expenses.currency, query.currency) : undefined,
      query.categoryId ? eq(expenses.categoryId, query.categoryId) : undefined,
    )
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(expenses).where(where)
        .limit(query.limit).offset(offset)
        .orderBy(sql`${expenses.date} DESC`),
      db.select({ value: count() }).from(expenses).where(where),
    ])
    return { data, total: Number(total), page: query.page, limit: query.limit }
  })

  fastify.post('/expenses', auth, async (request, reply) => {
    const body = createSchema.parse(request.body)
    const [expense] = await db.insert(expenses)
      .values({ ...body, userId: request.userId })
      .returning()
    return reply.status(201).send(expense)
  })

  fastify.get('/expenses/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const expense = await db.query.expenses.findFirst({
      where: and(eq(expenses.id, id), eq(expenses.userId, request.userId)),
    })
    if (!expense) return reply.status(404).send({ error: 'Not found' })
    return expense
  })

  fastify.put('/expenses/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = updateSchema.parse(request.body)
    const [expense] = await db.update(expenses)
      .set(body)
      .where(and(eq(expenses.id, id), eq(expenses.userId, request.userId)))
      .returning()
    if (!expense) return reply.status(404).send({ error: 'Not found' })
    return expense
  })

  fastify.delete('/expenses/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [expense] = await db.delete(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.userId, request.userId)))
      .returning()
    if (!expense) return reply.status(404).send({ error: 'Not found' })
    return { ok: true }
  })
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:api -- src/test/expenses.test.ts
```

Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/expenses.ts apps/api/src/test/expenses.test.ts
git commit -m "feat: expenses CRUD — paginated list, filter by currency/category, user-scoped"
```

---

### Task 10: Exchange rate service + /rates endpoint

**Files:**
- Create: `apps/api/src/services/exchange.service.ts`
- Create: `apps/api/src/routes/rates.ts`
- Create: `apps/api/src/test/rates.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/test/rates.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRate } from '../services/exchange.service.js'

describe('exchange.service', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns a number for CLP/USD', async () => {
    const rate = await getRate('USD', 'CLP')
    expect(typeof rate).toBe('number')
    expect(rate).toBeGreaterThan(0)
  })

  it('returns 1 when base and target are the same', async () => {
    expect(await getRate('CLP', 'CLP')).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:api -- src/test/rates.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/services/exchange.service.ts`**

```typescript
interface RateCache {
  rates: Record<string, number>
  fetchedAt: number
}

let cache: RateCache | null = null
const TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

async function fetchRates(base: string): Promise<Record<string, number>> {
  const res = await fetch(`https://api.frankfurter.app/latest?base=${base}`)
  if (!res.ok) throw new Error(`Exchange rate fetch failed: ${res.status}`)
  const json = await res.json() as { rates: Record<string, number> }
  return json.rates
}

export async function getRate(from: string, to: string): Promise<number> {
  if (from === to) return 1

  const now = Date.now()
  if (!cache || now - cache.fetchedAt > TTL_MS) {
    const rates = await fetchRates('USD')  // always fetch with USD as base
    cache = { rates, fetchedAt: now }
  }

  // Convert via USD as intermediary
  // rates are "1 USD = X currency"
  if (from === 'USD') return cache.rates[to] ?? 1
  if (to === 'USD') return 1 / (cache.rates[from] ?? 1)

  // both non-USD: from → USD → to
  const fromRate = cache.rates[from] ?? 1
  const toRate = cache.rates[to] ?? 1
  return toRate / fromRate
}
```

- [ ] **Step 4: Create `apps/api/src/routes/rates.ts`**

```typescript
import { FastifyPluginAsync } from 'fastify'
import { getRate } from '../services/exchange.service.js'

export const rateRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/rates', { onRequest: [fastify.authenticate] }, async () => {
    const clpPerUsd = await getRate('USD', 'CLP')
    return { USD_CLP: clpPerUsd, updatedAt: new Date().toISOString() }
  })
}
```

- [ ] **Step 5: Register route in `app.ts`**

```typescript
import { rateRoutes } from './routes/rates.js'
// inside buildApp():
await app.register(rateRoutes)
```

- [ ] **Step 6: Run tests**

```bash
npm run test:api -- src/test/rates.test.ts
```

Expected: PASS (note: this makes a real HTTP call to frankfurter.app — acceptable for now).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/exchange.service.ts apps/api/src/routes/rates.ts apps/api/src/test/rates.test.ts apps/api/src/app.ts
git commit -m "feat: exchange rate service — 24h cached USD/CLP rate via frankfurter.app"
```

---

### Task 11: Budgets routes + progress

**Files:**
- Create: `apps/api/src/routes/budgets.ts`
- Create: `apps/api/src/test/budgets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/test/budgets.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getTestApp } from './helpers/app.js'

const user = { email: 'bud@example.com', password: 'password123', name: 'Bud User' }
let token: string

beforeEach(async () => {
  const app = await getTestApp()
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: user })
  token = res.json().accessToken
})

async function authInject(method: string, url: string, payload?: object) {
  const app = await getTestApp()
  return app.inject({
    method: method as any, url, payload,
    headers: { Authorization: `Bearer ${token}` },
  })
}

const today = new Date().toISOString().slice(0, 10)

describe('POST /budgets', () => {
  it('creates a monthly budget', async () => {
    const res = await authInject('POST', '/budgets', {
      amount: '200000', currency: 'CLP', period: 'monthly',
      alertPct: 80, startsAt: today,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().period).toBe('monthly')
  })
})

describe('GET /budgets/:id/progress', () => {
  it('returns spent=0 for a new budget with no expenses', async () => {
    const create = await authInject('POST', '/budgets', {
      amount: '200000', currency: 'CLP', period: 'monthly',
      alertPct: 80, startsAt: today,
    })
    const { id } = create.json()
    const res = await authInject('GET', `/budgets/${id}/progress`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Number(body.spent)).toBe(0)
    expect(Number(body.total)).toBe(200000)
    expect(body.pct).toBe(0)
    expect(body.alert).toBe(false)
  })

  it('counts expenses in the current period and flags alert', async () => {
    const create = await authInject('POST', '/budgets', {
      amount: '10000', currency: 'CLP', period: 'monthly',
      alertPct: 80, startsAt: today,
    })
    const { id } = create.json()

    // add an expense in current month
    await authInject('POST', '/expenses', {
      amount: '9000', currency: 'CLP',
      description: 'Test', date: today,
    })

    const res = await authInject('GET', `/budgets/${id}/progress`)
    const body = res.json()
    expect(Number(body.spent)).toBe(9000)
    expect(body.pct).toBe(90)
    expect(body.alert).toBe(true)  // 90 >= 80
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:api -- src/test/budgets.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/routes/budgets.ts`**

```typescript
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { budgets, expenses } from '../db/schema.js'
import { eq, and, gte, lte, sum } from 'drizzle-orm'

const createSchema = z.object({
  categoryId: z.string().uuid().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.enum(['CLP', 'USD']).default('CLP'),
  period: z.enum(['monthly', 'quarterly', 'yearly']).default('monthly'),
  alertPct: z.number().int().min(1).max(100).default(80),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

function getPeriodRange(period: string, startsAt: string): { from: Date; to: Date } {
  const start = new Date(startsAt)
  const now = new Date()

  if (period === 'monthly') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    }
  }
  if (period === 'quarterly') {
    const q = Math.floor(now.getMonth() / 3)
    return {
      from: new Date(now.getFullYear(), q * 3, 1),
      to: new Date(now.getFullYear(), q * 3 + 3, 0),
    }
  }
  // yearly
  return {
    from: new Date(now.getFullYear(), 0, 1),
    to: new Date(now.getFullYear(), 11, 31),
  }
}

export const budgetRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  fastify.get('/budgets', auth, async (request) => {
    return db.select().from(budgets).where(eq(budgets.userId, request.userId))
  })

  fastify.post('/budgets', auth, async (request, reply) => {
    const body = createSchema.parse(request.body)
    const [budget] = await db.insert(budgets)
      .values({ ...body, userId: request.userId })
      .returning()
    return reply.status(201).send(budget)
  })

  fastify.get('/budgets/:id/progress', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const budget = await db.query.budgets.findFirst({
      where: and(eq(budgets.id, id), eq(budgets.userId, request.userId)),
    })
    if (!budget) return reply.status(404).send({ error: 'Not found' })

    const { from, to } = getPeriodRange(budget.period, budget.startsAt as string)

    const where = and(
      eq(expenses.userId, request.userId),
      budget.categoryId ? eq(expenses.categoryId, budget.categoryId) : undefined,
      eq(expenses.currency, budget.currency),
      gte(expenses.date, from.toISOString().slice(0, 10)),
      lte(expenses.date, to.toISOString().slice(0, 10)),
    )

    const [{ value: spent }] = await db.select({ value: sum(expenses.amount) })
      .from(expenses).where(where)

    const spentNum = Number(spent ?? 0)
    const totalNum = Number(budget.amount)
    const pct = totalNum > 0 ? Math.round((spentNum / totalNum) * 100) : 0

    return {
      spent: spentNum,
      total: totalNum,
      pct,
      alert: pct >= budget.alertPct,
      period: { from, to },
    }
  })

  fastify.put('/budgets/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createSchema.partial().parse(request.body)
    const [budget] = await db.update(budgets)
      .set(body)
      .where(and(eq(budgets.id, id), eq(budgets.userId, request.userId)))
      .returning()
    if (!budget) return reply.status(404).send({ error: 'Not found' })
    return budget
  })

  fastify.delete('/budgets/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [budget] = await db.delete(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.userId, request.userId)))
      .returning()
    if (!budget) return reply.status(404).send({ error: 'Not found' })
    return { ok: true }
  })
}
```

- [ ] **Step 4: Register in `app.ts`**

```typescript
import { budgetRoutes } from './routes/budgets.js'
// inside buildApp():
await app.register(budgetRoutes)
```

- [ ] **Step 5: Run tests**

```bash
npm run test:api -- src/test/budgets.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/budgets.ts apps/api/src/test/budgets.test.ts apps/api/src/app.ts
git commit -m "feat: budgets CRUD + progress endpoint with alert threshold"
```

---

### Task 12: Subscriptions routes + log renewal

**Files:**
- Create: `apps/api/src/routes/subscriptions.ts`
- Create: `apps/api/src/test/subscriptions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/test/subscriptions.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getTestApp } from './helpers/app.js'

const user = { email: 'sub@example.com', password: 'password123', name: 'Sub User' }
let token: string

beforeEach(async () => {
  const app = await getTestApp()
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: user })
  token = res.json().accessToken
})

async function authInject(method: string, url: string, payload?: object) {
  const app = await getTestApp()
  return app.inject({
    method: method as any, url, payload,
    headers: { Authorization: `Bearer ${token}` },
  })
}

const sub = {
  name: 'Netflix', amount: '8490', currency: 'CLP',
  renewalDate: '2026-05-01', notifyDays: 3,
}

describe('POST /subscriptions', () => {
  it('creates a subscription', async () => {
    const res = await authInject('POST', '/subscriptions', sub)
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('Netflix')
  })
})

describe('GET /subscriptions', () => {
  it('returns only active subscriptions by default', async () => {
    await authInject('POST', '/subscriptions', sub)
    await authInject('POST', '/subscriptions', { ...sub, name: 'Spotify', active: false })
    const res = await authInject('GET', '/subscriptions')
    expect(res.json()).toHaveLength(1)
  })
})

describe('POST /subscriptions/:id/log', () => {
  it('creates an expense from the renewal and bumps renewalDate by 1 month', async () => {
    const create = await authInject('POST', '/subscriptions', sub)
    const { id } = create.json()
    const res = await authInject('POST', `/subscriptions/${id}/log`)
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.expense.amount).toBe('8490.00')
    expect(body.subscription.renewalDate).toBe('2026-06-01')  // bumped 1 month
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm run test:api -- src/test/subscriptions.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/routes/subscriptions.ts`**

```typescript
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/index.js'
import { subscriptions, expenses } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const createSchema = z.object({
  name: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.enum(['CLP', 'USD']).default('CLP'),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notifyDays: z.number().int().min(1).default(3),
  active: z.boolean().default(true),
  notes: z.string().optional(),
})

export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  fastify.get('/subscriptions', auth, async (request) => {
    return db.select().from(subscriptions)
      .where(and(
        eq(subscriptions.userId, request.userId),
        eq(subscriptions.active, true),
      ))
  })

  fastify.post('/subscriptions', auth, async (request, reply) => {
    const body = createSchema.parse(request.body)
    const [sub] = await db.insert(subscriptions)
      .values({ ...body, userId: request.userId })
      .returning()
    return reply.status(201).send(sub)
  })

  fastify.put('/subscriptions/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createSchema.partial().parse(request.body)
    const [sub] = await db.update(subscriptions)
      .set(body)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, request.userId)))
      .returning()
    if (!sub) return reply.status(404).send({ error: 'Not found' })
    return sub
  })

  fastify.delete('/subscriptions/:id', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [sub] = await db.delete(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, request.userId)))
      .returning()
    if (!sub) return reply.status(404).send({ error: 'Not found' })
    return { ok: true }
  })

  // Log renewal: creates an expense + bumps the renewal date by one period
  fastify.post('/subscriptions/:id/log', auth, async (request, reply) => {
    const { id } = request.params as { id: string }
    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.id, id), eq(subscriptions.userId, request.userId)),
    })
    if (!sub) return reply.status(404).send({ error: 'Not found' })

    const today = new Date().toISOString().slice(0, 10)
    const [expense] = await db.insert(expenses).values({
      userId: request.userId,
      amount: sub.amount,
      currency: sub.currency,
      description: `${sub.name} subscription`,
      date: today,
    }).returning()

    // Bump renewal date by 1 month
    const current = new Date(sub.renewalDate as string)
    current.setMonth(current.getMonth() + 1)
    const nextRenewal = current.toISOString().slice(0, 10)

    const [updated] = await db.update(subscriptions)
      .set({ renewalDate: nextRenewal })
      .where(eq(subscriptions.id, id))
      .returning()

    return reply.status(201).send({ expense, subscription: updated })
  })
}
```

- [ ] **Step 4: Register in `app.ts`**

```typescript
import { subscriptionRoutes } from './routes/subscriptions.js'
// inside buildApp():
await app.register(subscriptionRoutes)
```

- [ ] **Step 5: Run tests**

```bash
npm run test:api -- src/test/subscriptions.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/subscriptions.ts apps/api/src/test/subscriptions.test.ts apps/api/src/app.ts
git commit -m "feat: subscriptions CRUD + log renewal creates expense and bumps date"
```

---

### Task 13: Dashboard endpoint

**Files:**
- Create: `apps/api/src/routes/dashboard.ts`
- Create: `apps/api/src/test/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/test/dashboard.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getTestApp } from './helpers/app.js'

const user = { email: 'dash@example.com', password: 'password123', name: 'Dash User' }
let token: string
const today = new Date().toISOString().slice(0, 10)

beforeEach(async () => {
  const app = await getTestApp()
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: user })
  token = res.json().accessToken
})

async function authInject(method: string, url: string, payload?: object) {
  const app = await getTestApp()
  return app.inject({
    method: method as any, url, payload,
    headers: { Authorization: `Bearer ${token}` },
  })
}

describe('GET /dashboard', () => {
  it('returns spentThisMonth, recent expenses, budgets, and upcoming subs', async () => {
    await authInject('POST', '/expenses', { amount: '5000', currency: 'CLP', description: 'Lunch', date: today })
    await authInject('POST', '/budgets', { amount: '100000', currency: 'CLP', period: 'monthly', alertPct: 80, startsAt: today })
    await authInject('POST', '/subscriptions', { name: 'Netflix', amount: '8490', currency: 'CLP', renewalDate: today, notifyDays: 3 })

    const res = await authInject('GET', '/dashboard')
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Number(body.spentThisMonth)).toBe(5000)
    expect(body.recentExpenses).toHaveLength(1)
    expect(body.budgets.length).toBeGreaterThan(0)
    expect(body.upcomingSubscriptions.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:api -- src/test/dashboard.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/routes/dashboard.ts`**

```typescript
import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/index.js'
import { expenses, budgets, subscriptions } from '../db/schema.js'
import { eq, and, gte, lte, sum, sql } from 'drizzle-orm'

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/dashboard', { onRequest: [fastify.authenticate] }, async (request) => {
    const userId = request.userId
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

    const [
      [{ total: spentThisMonth }],
      recentExpenses,
      userBudgets,
      userSubscriptions,
    ] = await Promise.all([
      db.select({ total: sum(expenses.amount) }).from(expenses)
        .where(and(
          eq(expenses.userId, userId),
          gte(expenses.date, monthStart),
          lte(expenses.date, monthEnd),
        )),
      db.select().from(expenses)
        .where(eq(expenses.userId, userId))
        .orderBy(sql`${expenses.date} DESC`)
        .limit(5),
      db.select().from(budgets).where(eq(budgets.userId, userId)),
      db.select().from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.active, true)))
        .orderBy(subscriptions.renewalDate)
        .limit(5),
    ])

    return {
      spentThisMonth: Number(spentThisMonth ?? 0),
      recentExpenses,
      budgets: userBudgets,
      upcomingSubscriptions: userSubscriptions,
    }
  })
}
```

- [ ] **Step 4: Register in `app.ts`**

```typescript
import { dashboardRoutes } from './routes/dashboard.js'
// inside buildApp():
await app.register(dashboardRoutes)
```

- [ ] **Step 5: Run tests**

```bash
npm run test:api -- src/test/dashboard.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/dashboard.ts apps/api/src/test/dashboard.test.ts apps/api/src/app.ts
git commit -m "feat: dashboard endpoint — aggregated monthly spend, recent expenses, budgets, subs"
```

---

### Task 14: Receipt scanning — Claude Vision API

**Files:**
- Create: `apps/api/src/services/claude.service.ts`
- Modify: `apps/api/src/routes/expenses.ts`
- Create: `apps/api/src/test/scan.test.ts`

- [ ] **Step 1: Write the failing test (using a mock)**

Create `apps/api/src/test/scan.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTestApp } from './helpers/app.js'
import * as claudeService from '../services/claude.service.js'

const user = { email: 'scan@example.com', password: 'password123', name: 'Scan User' }
let token: string

beforeEach(async () => {
  const app = await getTestApp()
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: user })
  token = res.json().accessToken
  vi.restoreAllMocks()
})

describe('POST /expenses/scan', () => {
  it('returns extracted expense data from receipt image', async () => {
    vi.spyOn(claudeService, 'scanReceipt').mockResolvedValue({
      amount: '3500',
      currency: 'CLP',
      description: 'Coffee',
      date: '2026-04-19',
      suggestedCategory: 'coffee',
    })

    const app = await getTestApp()
    // send a minimal JPEG buffer as multipart
    const boundary = 'TestBoundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="receipt"; filename="test.jpg"',
      'Content-Type: image/jpeg',
      '',
      'fake-image-bytes',
      `--${boundary}--`,
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/expenses/scan',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.amount).toBe('3500')
    expect(data.description).toBe('Coffee')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test:api -- src/test/scan.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `apps/api/src/services/claude.service.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

const client = new Anthropic({ apiKey: config.CLAUDE_API_KEY })

export interface ScannedReceipt {
  amount: string
  currency: string
  description: string
  date: string
  suggestedCategory: string
}

export async function scanReceipt(imageBase64: string, mimeType: string): Promise<ScannedReceipt> {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType as 'image/jpeg', data: imageBase64 },
        },
        {
          type: 'text',
          text: `Extract the following fields from this receipt and return ONLY valid JSON, no other text:
{
  "amount": "number as string, e.g. 3500",
  "currency": "CLP or USD",
  "description": "merchant name or item description, max 60 chars",
  "date": "YYYY-MM-DD format",
  "suggestedCategory": "one of: food, transport, entertainment, health, home, other"
}`,
        },
      ],
    }],
  })

  const text = (message.content[0] as { type: string; text: string }).text
  return JSON.parse(text) as ScannedReceipt
}
```

- [ ] **Step 4: Add `/expenses/scan` route to `apps/api/src/routes/expenses.ts`**

Add this route inside `expenseRoutes` (before the closing `}`):
```typescript
// at top of file, add:
import multipart from '@fastify/multipart'
import { scanReceipt } from '../services/claude.service.js'

// inside expenseRoutes, register multipart support and add route:
await fastify.register(multipart)

fastify.post('/expenses/scan', auth, async (request, reply) => {
  const data = await request.file()
  if (!data) return reply.status(400).send({ error: 'No file uploaded' })

  const buffer = await data.toBuffer()
  const base64 = buffer.toString('base64')
  const mimeType = data.mimetype

  const result = await scanReceipt(base64, mimeType)
  return result
})
```

- [ ] **Step 5: Run tests**

```bash
npm run test:api -- src/test/scan.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/claude.service.ts apps/api/src/routes/expenses.ts apps/api/src/test/scan.test.ts
git commit -m "feat: receipt scanning — Claude Vision extracts amount, currency, description, date"
```

---

### Task 15: Swagger docs

**Files:**
- Create: `apps/api/src/plugins/swagger.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create `apps/api/src/plugins/swagger.ts`**

```typescript
import fp from 'fastify-plugin'
import { FastifyPluginAsync } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

const swaggerPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      info: { title: 'Clarity API', version: '1.0.0', description: 'Personal finance tracking' },
      components: {
        securitySchemes: {
          BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ BearerAuth: [] }],
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  })
}

export default fp(swaggerPlugin)
```

- [ ] **Step 2: Register in `app.ts`**

```typescript
import swaggerPlugin from './plugins/swagger.js'
// inside buildApp(), BEFORE other routes:
await app.register(swaggerPlugin)
```

- [ ] **Step 3: Start server and verify docs load**

```bash
npm run dev:api
```

Open `http://localhost:3000/docs` — Swagger UI should load with all routes listed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/plugins/swagger.ts apps/api/src/app.ts
git commit -m "feat: Swagger/OpenAPI docs at /docs"
```

---

### Task 16: Docker + docker-compose

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `apps/api/Dockerfile`**

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=apps/api

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Create `docker-compose.yml` at repo root**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: clarity
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/clarity
      JWT_SECRET: ${JWT_SECRET}
      CLAUDE_API_KEY: ${CLAUDE_API_KEY}
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

- [ ] **Step 3: Build and run**

```bash
JWT_SECRET=your-32-char-secret-here CLAUDE_API_KEY=your-key docker compose up --build
```

Expected: API starts at `http://localhost:3000`, `/health` returns `{"status":"ok"}`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/Dockerfile docker-compose.yml
git commit -m "feat: Docker + docker-compose for local dev and production"
```

---

### Task 17: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Lint, test, build
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: clarity_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run migrations
        run: npm run db:migrate --workspace=apps/api
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/clarity_test

      - name: Run tests
        run: npm run test:api
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/clarity_test
          JWT_SECRET: ci-test-secret-that-is-at-least-32-chars
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
          NODE_ENV: test

      - name: Build
        run: npm run build:api
```

- [ ] **Step 2: Add `CLAUDE_API_KEY` secret in GitHub**

Go to repo → Settings → Secrets and variables → Actions → New repository secret.
Name: `CLAUDE_API_KEY`, value: your key.

- [ ] **Step 3: Push and verify CI passes**

```bash
git add .github/
git commit -m "ci: GitHub Actions — lint, test, build on every push"
git push origin main
```

Open the Actions tab on GitHub. Expected: green checkmark.

---

## Run the full test suite

After all tasks are complete, run everything:

```bash
npm run test:api
```

Expected output (all passing):
```
✓ src/test/health.test.ts (1)
✓ src/test/auth.service.test.ts (5)
✓ src/test/auth.test.ts (8)
✓ src/test/categories.test.ts (5)
✓ src/test/expenses.test.ts (7)
✓ src/test/rates.test.ts (2)
✓ src/test/budgets.test.ts (3)
✓ src/test/subscriptions.test.ts (3)
✓ src/test/dashboard.test.ts (1)
✓ src/test/scan.test.ts (1)

Test Files  10 passed (10)
Tests       36 passed (36)
```
