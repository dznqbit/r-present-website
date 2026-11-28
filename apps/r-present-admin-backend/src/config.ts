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
  uploads: {
    // When S3_BUCKET is set, photos go to that bucket and are served via
    // IMAGES_BASE_URL. Otherwise they land in a local folder and are served by
    // this backend, which is only good for development.
    bucket: process.env.S3_BUCKET ?? null,
    region: process.env.S3_REGION ?? 'us-west-2',
    // An S3-compatible service instead of AWS, e.g. Cloudflare R2:
    // https://<account-id>.r2.cloudflarestorage.com (with S3_REGION=auto).
    endpoint: process.env.S3_ENDPOINT || null,
    // Key prefix, e.g. "dev/" on a laptop so test uploads stay separate.
    prefix: process.env.S3_PREFIX ?? '',
    publicBaseUrl: (process.env.IMAGES_BASE_URL ?? '').replace(/\/+$/, ''),
    localDir: path.resolve(process.env.LOCAL_UPLOAD_DIR ?? path.join(siteDir, '..', '..', '.uploads')),
    localBaseUrl: `http://localhost:${Number(process.env.PORT ?? 8787)}/api/media`,
    maxBytes: 30 * 1024 * 1024,
  },
  publish: {
    // Publishing pushes a content-only commit on top of <remote>/<branch>.
    remote: process.env.PUBLISH_REMOTE ?? 'origin',
    branch: process.env.PUBLISH_BRANCH ?? 'main',
    authorName: process.env.PUBLISH_AUTHOR_NAME ?? 'R. Present Admin',
    authorEmail: process.env.PUBLISH_AUTHOR_EMAIL ?? 'admin@r-present.com',
  },
}
