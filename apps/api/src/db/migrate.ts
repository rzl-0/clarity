import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './index.js'

await migrate(db, { migrationsFolder: './src/db/migrations' })
console.log('Migrations complete')
process.exit(0)
