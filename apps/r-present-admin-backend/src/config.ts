import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: Number(process.env.PORT ?? 8787),
  // Path to the r-present-website app whose src/content/ we edit.
  // Defaults to the sibling app in this monorepo; on the Pi, point it
  // at the dedicated clone.
  siteDir: path.resolve(
    process.env.SITE_DIR ?? path.join(here, '..', '..', 'r-present-website'),
  ),
}
