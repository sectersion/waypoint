import { rpc } from './socket-client.js'

export const waypoint = {
  state: {
    get: async (key: string): Promise<unknown> => {
      const res = await rpc<{ ok: true; value: unknown }>({ op: 'get', key })
      return res.value
    },
    set: async (key: string, value: unknown): Promise<void> => {
      await rpc({ op: 'set', key, value })
    },
    delete: async (key: string): Promise<void> => {
      await rpc({ op: 'delete', key })
    },
  },
}