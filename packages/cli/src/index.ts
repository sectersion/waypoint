#!/usr/bin/env node
import { deployCommand } from './commands/deploy.js'
import { agentsCommand } from './commands/agents.js'
import { logsCommand } from './commands/logs.js'

const argv = process.argv.slice(2)
const cmd = argv[0]
const subcmd = argv[1]

async function main(): Promise<void> {
  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    return printHelp()
  }
  if (cmd === 'deploy') {
    await deployCommand()
    return
  }
  if (cmd === 'agents') {
    if (subcmd !== 'list') {
      throw new Error(`unknown agents subcommand: ${subcmd ?? '(none)'}`)
    }
    await agentsCommand(subcmd)
    return
  }
  if (cmd === 'logs') {
    const name = subcmd
    const limit = parseLimit(argv)
    await logsCommand(name ?? '', limit)
    return
  }
  throw new Error(`unknown command: ${cmd}`)
}

function parseLimit(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-n' && argv[i + 1]) return Math.max(1, Math.min(1000, Number(argv[i + 1])))
    if (argv[i]?.startsWith('-n=')) return Math.max(1, Math.min(1000, Number(argv[i]!.slice(3))))
  }
  return 100
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`error: ${message}`)
  process.exit(1)
})

function printHelp(): void {
  console.log(
    `waypoint CLI v0.0.1

commands:
  deploy              bundle entrypoint from waypoint.json and ship to runtime
  agents list         list deployed agents at the configured server
  logs [name] [-n N]  tail last N log lines (default 100) from the agent's current deployment

env:
  WAYPOINT_SERVER     override server from waypoint.json
  WAYPOINT_AGENT      override agent from waypoint.json`,
  )
}