import { pgTable, uuid, text, timestamp, integer, jsonb, primaryKey } from 'drizzle-orm/pg-core'

export const agents = pgTable('agents', {
  id:                  uuid('id').defaultRandom().primaryKey(),
  name:                text('name').notNull().unique(),
  currentDeploymentId: uuid('current_deployment_id'),
  replicas:            integer('replicas').notNull().default(1),
  createdAt:           timestamp('created_at').defaultNow().notNull(),
})

export const deployments = pgTable('deployments', {
  id:        uuid('id').defaultRandom().primaryKey(),
  agentId:   uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  version:   integer('version').notNull(),
  buildHash: text('build_hash').notNull(),
  env:       jsonb('env').notNull().default({}),
  status:    text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const invocations = pgTable('invocations', {
  id:           uuid('id').defaultRandom().primaryKey(),
  agentId:      uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  deploymentId: uuid('deployment_id').notNull().references(() => deployments.id, { onDelete: 'cascade' }),
  startedAt:    timestamp('started_at').notNull(),
  endedAt:      timestamp('ended_at'),
  statusCode:   integer('status_code'),
})

export const stateKv = pgTable('state_kv', {
  agentId:   uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  key:       text('key').notNull(),
  value:     jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.key] }),
}))