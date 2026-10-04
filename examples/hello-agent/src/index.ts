// TODO: replace with a real Mastra agent (phase 2).
// MVP-0 just needs the bundle to load. Phase 2 wires Mastra's Node adapter.

export default {
  name: 'hello-agent',
  handle: async () => 'hello from hello-agent v0',
}