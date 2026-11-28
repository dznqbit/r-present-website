/**
 * One-time job: make the smaller copies (see VARIANT_WIDTHS in uploads.ts) for
 * photos uploaded before uploads started making them. Finds every photo URL in
 * the site's content, skips any whose copies already exist, and stores copies
 * for the rest. Safe to re-run; it never touches the original photos.
 *
 *   npm run backfill-variants -- --dry-run
 *   npm run backfill-variants
 *
 * Needs the same S3_* / IMAGES_BASE_URL / AWS_* settings as the backend (.env).
 * Note S3_PREFIX is ignored: keys come from the URLs themselves.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import { storeVariants, VARIANT_WIDTHS, variantKey } from './uploads.js'

const dryRun = process.argv.includes('--dry-run')
const { bucket, publicBaseUrl } = config.uploads
if (!bucket || !publicBaseUrl) {
  console.error('Set S3_BUCKET and IMAGES_BASE_URL (see .env.example).')
  process.exit(1)
}

async function jsonFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((e) => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return jsonFiles(p)
      return Promise.resolve(e.name.endsWith('.json') ? [p] : [])
    }),
  )
  return nested.flat()
}

// Only photos our uploader made: content-hash names under IMAGES_BASE_URL.
const escaped = publicBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PHOTO_URL = new RegExp(`${escaped}/[\\w/-]*?[0-9a-f]{20}\\.jpg`, 'g')

const urls = new Set<string>()
for (const file of await jsonFiles(path.join(config.siteDir, 'src', 'content'))) {
  for (const m of (await fs.readFile(file, 'utf8')).matchAll(PHOTO_URL)) urls.add(m[0])
}
console.log(`${urls.size} photo(s) in content${dryRun ? ' (dry run)' : ''}`)

let made = 0
for (const url of urls) {
  const key = url.slice(publicBaseUrl.length + 1)
  const largest = variantKey(url, Math.max(...VARIANT_WIDTHS))
  if ((await fetch(largest, { method: 'HEAD' })).ok) {
    console.log(`  ok       ${key}`)
    continue
  }
  if (dryRun) {
    console.log(`  missing  ${key}`)
    continue
  }
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`  SKIP     ${key} (original returned ${res.status})`)
    continue
  }
  await storeVariants(key, Buffer.from(await res.arrayBuffer()))
  made++
  console.log(`  made     ${key}`)
}
console.log(dryRun ? 'Dry run, nothing stored.' : `Made copies for ${made} photo(s).`)
