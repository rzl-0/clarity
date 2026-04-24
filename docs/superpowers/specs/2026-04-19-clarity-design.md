# Clarity — Design Spec

**Date:** 2026-04-19  
**Status:** Approved  

---

## 1. Overview

**Clarity** is a multi-user personal finance tracking app. It runs on iPhone (iOS) and web from a single codebase. The three core features are:

1. **Expense tracking** — manual entry and AI-powered receipt photo scanning
2. **Budgets** — per-category budgets with flexible periods (monthly, quarterly, yearly) and configurable alert thresholds
3. **Subscriptions** — recurring charges tracked with renewal dates, currency tags, and pre-renewal push notifications

Built as a portfolio project targeting US/Canada senior engineering roles. The architecture reflects production-grade decisions: a custom REST API, proper auth implementation, containerization, CI/CD, and tests.

The app must feel fast and low-friction. Logging an expense should take seconds, not a form.

---

## 2. Tech Stack

### Frontend / Mobile
| Layer | Choice | Reason |
|---|---|---|
| App framework | React Native + Expo | iOS + web from one codebase |
| State | Zustand + `persist` middleware | Lightweight; persist handles local cache for offline reads |
| i18n | react-i18next | Spanish primary, English secondary |
| Push notifications | Expo Notifications | Works on iOS and web |

### Backend API
| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 22 + TypeScript | Industry standard for TS backends |
| Framework | **Fastify** | Performance leader, clean plugin architecture, well-recognized by US hiring managers |
| Validation | **Zod** | Standard in TS stacks, pairs cleanly with Fastify |
| ORM | **Drizzle** | Code-first TypeScript, SQL-like API, tiny bundle, shows SQL fluency vs ActiveRecord magic |
| Auth | **Custom JWT with `jose` + `argon2`** | Implement from scratch: password hashing, access token (15min), refresh token rotation (7d). Interviewable, no magic. Add better-auth later for social login. |
| Database | **Supabase Postgres** | Managed Postgres — no infra to maintain, free tier |
| File storage | **Supabase Storage** | Receipt photos |
| AI scanning | **Fastify route → Claude Vision API** | Standard API call, no Edge Function needed |

### Infrastructure
| Layer | Choice |
|---|---|
| Containerization | Docker + docker-compose (local dev) |
| CI/CD | GitHub Actions — lint, test, build on every PR |
| Testing | Vitest (unit + integration) |
| API docs | Swagger via `@fastify/swagger` |

### Architecture pattern

```
[React Native / Expo] ──HTTP──▶ [Fastify API] ──▶ [Supabase Postgres]
                                      │
                                      └──▶ [Claude Vision API]  (receipt scanning)
                                      └──▶ [Supabase Storage]   (receipt photos)
```

- All client requests go through the **Fastify API** — no direct DB access from client
- Auth: JWT access token in `Authorization` header; refresh token in `httpOnly` cookie
- Every DB query filters by `user_id` from the JWT payload — user isolation enforced in the query layer, not just RLS

---

## 3. Data Model

### `users`
```
id            uuid PK
email         text UNIQUE
password_hash text              -- argon2 hash
name          text
currency      text              -- 'CLP' | 'USD' (primary display currency)
locale        text              -- 'es' | 'en'
created_at    timestamptz
```

### `refresh_tokens`
```
id            uuid PK
user_id       uuid FK
token_hash    text              -- hashed refresh token
expires_at    timestamptz
revoked_at    timestamptz nullable
created_at    timestamptz
```

### `expenses`
```
id            uuid PK
user_id       uuid FK
amount        numeric           -- always in original currency
currency      text              -- 'CLP' | 'USD'
category_id   uuid FK
description   text
date          date
receipt_url   text nullable     -- Supabase Storage path
created_at    timestamptz
```

### `categories`
```
id        uuid PK
user_id   uuid FK
name      text
icon      text                  -- icon slug
color     text                  -- hex
```

### `budgets`
```
id            uuid PK
user_id       uuid FK
category_id   uuid FK nullable  -- null = overall budget
amount        numeric
currency      text
period        text              -- 'monthly' | 'quarterly' | 'yearly'
alert_pct     integer           -- notify at X% (default 80)
starts_at     date
```

### `subscriptions`
```
id              uuid PK
user_id         uuid FK
name            text
amount          numeric
currency        text
renewal_date    date
notify_days     integer         -- notify N days before renewal (default 3)
active          boolean
notes           text nullable
```

---

## 4. Auth Flow

### Registration
```
POST /auth/register
  body: { email, password, name }
  → hash password with argon2
  → insert user
  → return { accessToken, user }
```

### Login
```
POST /auth/login
  body: { email, password }
  → verify argon2 hash
  → sign access token (JWT, 15min, jose)
  → generate refresh token, store hash in DB
  → set refresh token in httpOnly cookie
  → return { accessToken, user }
```

### Token refresh
```
POST /auth/refresh
  cookie: refreshToken
  → verify token exists + not revoked + not expired
  → rotate: revoke old, issue new refresh token
  → return new { accessToken }
```

### Protected routes
```
Fastify preHandler hook:
  → extract Bearer token from Authorization header
  → verify JWT signature + expiry with jose
  → attach payload.sub (userId) to request context
  → all subsequent handlers use request.userId
```

---

## 5. Core Features

### 5.1 Expense Entry

Two paths:
- **Manual** — `POST /expenses`. Amount field autofocuses on open. Category is a horizontal scroll of icon pills.
- **Scan receipt** — `POST /expenses/scan`. Client sends photo → API forwards to Claude Vision → returns `{ amount, currency, description, date, suggested_category }`. User confirms or edits, then saves.

### 5.2 Budgets

- One active budget per category per period. Optional overall budget (no category).
- Budget progress: `GET /budgets/:id/progress` — Drizzle query sums expenses for current period, returns `{ spent, total, pct }`.
- Alert: when `pct >= alert_pct`, the API sets a flag in the response; the client schedules a local notification via Expo.
- Periods: `monthly` resets on 1st, `quarterly`/`yearly` anchor from `starts_at`.

### 5.3 Subscriptions

- `renewal_date` drives the countdown shown in the UI.
- `notify_days` (default 3): client schedules local notification on app foreground.
- Not auto-logged as expenses — user taps "Log renewal" to create an expense manually.

### 5.4 Multi-currency

- Amounts stored in original currency.
- Exchange rate: fetched daily from a free API (e.g. Frankfurter), cached in-memory on the API server with a 24h TTL.
- Dashboard total shown in user's `primary_currency`, with tap-to-reveal secondary.

### 5.5 i18n

- `react-i18next`. Default locale: `es`.
- `scripts/translate.ts` — fills missing English keys by calling Claude API. Human review before commit.

---

## 6. API Routes

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /expenses          ?page, limit, category, from, to, currency
POST   /expenses
GET    /expenses/:id
PUT    /expenses/:id
DELETE /expenses/:id
POST   /expenses/scan     (multipart: photo)

GET    /categories
POST   /categories
PUT    /categories/:id
DELETE /categories/:id

GET    /budgets
POST   /budgets
GET    /budgets/:id/progress
PUT    /budgets/:id
DELETE /budgets/:id

GET    /subscriptions
POST   /subscriptions
PUT    /subscriptions/:id
DELETE /subscriptions/:id
POST   /subscriptions/:id/log   (creates expense from renewal)

GET    /dashboard               (aggregated: spent, budgets, upcoming subs)
GET    /rates                   (current CLP/USD exchange rate)
```

---

## 7. Visual Identity

### Name
**clarity** — lowercase, always.

### Mark
Diamond (nested double-diamond + center dot). Inline SVG, no image assets. Works at 16px through 1024px.

### Colors
| Token | Value | Use |
|---|---|---|
| `bg` | `#06060f` | App background |
| `surface` | `#0d0d28` | Cards |
| `border` | `#141440` | Card borders |
| `gradient-from` | `#7c6af7` | Purple — primary accent |
| `gradient-to` | `#4ecdc4` | Teal — secondary accent |
| `text-primary` | `#f0f0ff` | Headings, amounts |
| `text-secondary` | `#6060a0` | Labels, dates |
| `text-muted` | `#2a2a60` | Placeholders, hints |
| `danger` | `#ff7eb3` | Over-budget, errors |

### Typography
- **SF Pro Display** (iOS) / **Segoe UI** (Windows) / system sans-serif
- Amounts: tabular nums, `letter-spacing: -0.5px`
- Labels: uppercase, `letter-spacing: 1.5px`, 10–11px

---

## 8. Key Screens

| Screen | Purpose |
|---|---|
| **Home / Dashboard** | Monthly overview, recent expenses, budget bars, subscription countdown |
| **Expenses** | Full list, filterable by category / date range / currency |
| **Add Expense** | Bottom sheet — amount (autofocus), category pills, description, date |
| **Scan Receipt** | Camera → loading → confirm/edit extracted data |
| **Budgets** | List with progress bars; tap to edit |
| **Subscriptions** | Card list with renewal countdowns; tap to log or edit |
| **Settings** | Currency, language, notification config |

---

## 9. Project Structure

```
clarity/
├── apps/
│   ├── api/               # Fastify TypeScript backend
│   │   ├── src/
│   │   │   ├── routes/    # One file per resource
│   │   │   ├── services/  # Business logic
│   │   │   ├── db/        # Drizzle schema + migrations
│   │   │   ├── lib/       # jwt, argon2, exchange rate, claude
│   │   │   └── plugins/   # Fastify plugins (auth hook, swagger)
│   │   ├── Dockerfile
│   │   └── vitest.config.ts
│   └── mobile/            # React Native + Expo
│       └── src/
│           ├── screens/
│           ├── components/
│           ├── store/     # Zustand
│           └── i18n/
├── docker-compose.yml
├── .github/workflows/ci.yml
└── scripts/translate.ts
```

---

## 10. Out of Scope (MVP)

- Social login (add better-auth later)
- Bank sync / open banking
- Investment tracking
- Receipt OCR for PDF / email
- Web push notifications
- Recurring expense auto-logging

---

## 11. Success Criteria

- Logging an expense takes under 10 seconds (manual path)
- Receipt scan returns pre-filled form in under 5 seconds
- Dashboard loads without spinner on repeat visits (Zustand persist cache)
- All API routes covered by integration tests (Vitest)
- CI passes on every PR: lint → test → build
- `docker compose up` starts the full stack locally in one command
