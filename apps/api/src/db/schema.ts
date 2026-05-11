import {
  pgTable, uuid, text, numeric, integer,
  boolean, date, timestamp,
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
  id:     uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:   text('name').notNull(),
  icon:   text('icon').notNull().default('tag'),
  color:  text('color').notNull().default('#7c6af7'),
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
  period:     text('period').notNull().default('monthly'),
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
