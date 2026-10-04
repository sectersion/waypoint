import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const url = process.env.DATABASE_URL ?? 'postgres://waypoint:waypoint@localhost:5432/waypoint'
export const pool = new Pool({ connectionString: url })
export const db = drizzle(pool, { schema })