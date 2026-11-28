import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { config } from './config.js'

// The Pi 3 has ~1GB of RAM shared with Pi-hole. Keep sharp lean and do one
// image at a time.
sharp.cache(false)
sharp.concurrency(1)

/** Longest edge of a stored photo. Plenty for the site, ~10x smaller than a phone original. */
const MAX_EDGE = 2000

/**
 * Smaller copies saved next to each photo as {hash}-{width}.jpg, so pages can
 * offer a srcset instead of sending the full photo to every thumbnail. The
 * site's src/lib/images.ts lists the same widths; keep the two in sync.
 */
export const VARIANT_WIDTHS = [400, 800, 1200] as const

export type Uploaded = { url: string; width: number; height: number; bytes: number }

export class UnsupportedImageError extends Error {}

/**
 * Make a phone photo web-ready: honor its EXIF rotation, shrink it, and
 * re-encode as JPEG. Sharp drops all metadata unless asked to keep it, so the
 * GPS location phones embed never reaches the public site.
 */
async function processImage(input: Buffer): Promise<{ body: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    return { body: data, width: info.width, height: info.height }
  } catch (err) {
    throw new UnsupportedImageError(
      `That file couldn't be read as a photo (${err instanceof Error ? err.message : String(err)}).`,
    )
  }
}

// Collections become folder names, so keep them tame.
const SAFE_SEGMENT = /^[a-z0-9-]+$/

let s3: S3Client | null = null

async function store(key: string, body: Buffer): Promise<string> {
  const { bucket, region, endpoint, publicBaseUrl, localDir, localBaseUrl } = config.uploads
  if (bucket) {
    s3 ??= new S3Client(
      endpoint
        ? {
            region,
            endpoint,
            // R2 and friends want the bucket in the path, not the hostname.
            forcePathStyle: true,
            // Newer SDKs add checksum headers by default; S3-compatible
            // services don't all accept them. Only send them when required.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
          }
        : { region },
    )
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'image/jpeg',
        // Keys are content hashes, so a given URL never changes contents.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    )
    return `${publicBaseUrl}/${key}`
  }
  const file = path.join(localDir, key)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
  return `${localBaseUrl}/${key}`
}

/** `products/abc.jpg` -> `products/abc-400.jpg` */
export const variantKey = (key: string, width: number) => key.replace(/\.jpg$/, `-${width}.jpg`)

/** Store the smaller copies of the photo at `key`. One at a time, to keep memory down on the Pi. */
export async function storeVariants(key: string, body: Buffer): Promise<void> {
  for (const width of VARIANT_WIDTHS) {
    const variant = await sharp(body)
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()
    await store(variantKey(key, width), variant)
  }
}

/**
 * Store a processed photo plus its smaller copies under `key`. The copies go
 * first, so by the time the full photo's URL exists, its copies do too.
 */
async function storeWithVariants(key: string, body: Buffer): Promise<string> {
  await storeVariants(key, body)
  return store(key, body)
}

export async function uploadImage(collection: string, input: Buffer): Promise<Uploaded> {
  if (!SAFE_SEGMENT.test(collection)) throw new UnsupportedImageError('Unknown collection')
  const { body, width, height } = await processImage(input)
  // Name by content so re-uploading the same photo reuses the same file.
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 20)
  const key = `${config.uploads.prefix}${collection}/${hash}.jpg`
  const url = await storeWithVariants(key, body)
  return { url, width, height, bytes: body.length }
}

/** Where to read a locally stored upload from, or null if the path is unsafe/missing. */
export function localUploadPath(key: string): string | null {
  const root = config.uploads.localDir
  const file = path.resolve(root, key)
  return file.startsWith(root + path.sep) ? file : null
}

/** True when uploads only live on this machine (no S3 configured). */
export const usingLocalUploads = () => config.uploads.bucket === null
