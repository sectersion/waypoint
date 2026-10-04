import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const url = process.env.DATABASE_URL ?? 'postgres://waypoint:waypoint@localhost:5432/waypoint'
const pool = new Pool({ connectionString: url })
const db = drizzle(pool)
await migrate(db, { migrationsFolder: './drizzle' })
console.log('migrations applied')
await pool.end()