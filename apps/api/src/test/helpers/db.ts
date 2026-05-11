import { afterEach } from 'vitest'
import { db } from '../../db/index.js'
import {
  expenses, budgets, subscriptions,
  categories, refreshTokens, users,
} from '../../db/schema.js'

afterEach(async () => {
  await db.delete(expenses)
  await db.delete(subscriptions)
  await db.delete(budgets)
  await db.delete(categories)
  await db.delete(refreshTokens)
  await db.delete(users)
})
