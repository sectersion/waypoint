import { tmpdir } from 'node:os'
import path from 'node:path'

export const config = {
  port:        Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://waypoint:waypoint@localhost:5432/waypoint',
  runtimeUrl:  process.env.WAYPOINT_RUNTIME_URL ?? 'http://127.0.0.1:3030',
  artifactsDir: process.env.WAYPOINT_ARTIFACTS_DIR ?? path.join(tmpdir(), 'waypoint-artifacts'),
}