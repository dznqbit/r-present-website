import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

// Path to the r-present-website app whose src/content/ we edit.
// Defaults to the sibling app in this monorepo; on the Pi, point it
// at the dedicated clone.
const siteDir = path.resolve(
  process.env.SITE_DIR ?? path.join(here, '..', '..', 'r-present-website'),
)

export const config = {
  port: Number(process.env.PORT ?? 8787),
  siteDir,
  // Where preview builds land. Served at the root of its own port, because the
  // site uses root-relative URLs (/images/…) and can't live under a subpath.
  previewDir: path.resolve(process.env.PREVIEW_DIR ?? path.join(siteDir, '..', '..', '.preview')),
  previewPort: Number(process.env.PREVIEW_PORT ?? 8081),
}
