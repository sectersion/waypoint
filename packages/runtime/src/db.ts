import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { stateKv } from './state-schema.js'

const url = process.env.DATABASE_URL ?? 'postgres://waypoint:waypoint@localhost:5432/waypoint'
export const pool = new Pool({ connectionString: url })
export const db = drizzle(pool, { schema: { stateKv } })