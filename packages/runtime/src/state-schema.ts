import { pgTable, uuid, text, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core'

// ponytail: duplicated from server's db/schema.ts so the runtime package has
// no cross-package schema dep. The server's drizzle migration is the source
// of truth for the table; runtime's definition just gives us typed queries.
// Keep columns / types / names in sync with packages/server/src/db/schema.ts.
export const stateKv = pgTable('state_kv', {
  agentId:   uuid('agent_id').notNull(),
  key:       text('key').notNull(),
  value:     jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.key] }),
}))