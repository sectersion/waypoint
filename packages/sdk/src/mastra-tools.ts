import { waypoint } from './internal.js'

export interface WaypointTool<TIn, TOut> {
  id: string
  description: string
  execute: (input: TIn) => Promise<TOut>
}

export function waypointMastraTools(): {
  stateGet:    WaypointTool<{ key: string }, unknown>
  stateSet:    WaypointTool<{ key: string; value: unknown }, { ok: boolean }>
  stateDelete: WaypointTool<{ key: string }, { ok: boolean }>
} {
  return {
    stateGet: {
      id: 'waypoint_state_get',
      description: 'Read a value from agent-scoped persistent state. Returns null when the key does not exist.',
      execute: async ({ key }) => waypoint.state.get(key),
    },
    stateSet: {
      id: 'waypoint_state_set',
      description: 'Write a value to agent-scoped persistent state. Overwrites any existing value at the key.',
      execute: async ({ key, value }) => {
        await waypoint.state.set(key, value)
        return { ok: true }
      },
    },
    stateDelete: {
      id: 'waypoint_state_delete',
      description: 'Delete a key from agent-scoped persistent state.',
      execute: async ({ key }) => {
        await waypoint.state.delete(key)
        return { ok: true }
      },
    },
  }
}