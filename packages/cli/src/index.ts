#!/usr/bin/env node
import { deployCommand } from './commands/deploy.js'
import { agentsCommand } from './commands/agents.js'

const [, , cmd, subcmd] = process.argv

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
  throw new Error(`unknown command: ${cmd}`)
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

env:
  WAYPOINT_SERVER     override server from waypoint.json
  WAYPOINT_AGENT      override agent from waypoint.json`,
  )
}