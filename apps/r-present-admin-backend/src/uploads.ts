import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { config } from './config.js'

// The Pi 3 has ~1GB of RAM shared with Pi-hole. Keep sharp lean and do one
// image at a time.
sharp.cache(false)
sharp.concurrency(1)

/** Longest edge of a display photo (originals are kept full size). Plenty for the site. */
const MAX_EDGE = 2000

/**
 * Smaller copies saved next to each photo as {hash}-{width}.jpg, so pages can
 * offer a srcset instead of sending the full photo to every thumbnail. The
 * site's src/lib/images.ts lists the same widths; keep the two in sync.
 */
export const VARIANT_WIDTHS = [400, 800, 1200] as const

/**
 * Collections whose photos are cropped to a fixed shape (width / height), so
 * the site can lay them out predictably. The admin's src/api.ts lists the same
 * shapes for its crop tool; keep the two in sync. Others keep their own shape.
 */
export const PHOTO_ASPECT: Record<string, number> = {
  products: 3 / 4,
}

/**
 * How to cut a display photo from its original, as the admin's crop tool
 * reports it: turn the original `rotation` degrees clockwise (a quarter turn
 * at a time), then keep the box, given as percentages (0–100) of the turned photo.
 */
export type Crop = { x: number; y: number; width: number; height: number; rotation?: Rotation }
type Rotation = 0 | 90 | 180 | 270

export type Uploaded = { url: string; width: number; height: number; bytes: number }

export class UnsupportedImageError extends Error {}

/** Parse and sanity-check a crop box sent by a client. */
export function parseCrop(raw: unknown): Crop {
  let c: Partial<Crop> | null
  try {
    c = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<Crop> | null
  } catch {
    throw new UnsupportedImageError('The crop box was invalid.')
  }
  const nums = [c?.x, c?.y, c?.width, c?.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) {
    throw new UnsupportedImageError('The crop box was invalid.')
  }
  const [x, y, width, height] = nums as number[]
  if (width! <= 0 || height! <= 0) throw new UnsupportedImageError('The crop box was empty.')
  const rotation = c?.rotation ?? 0
  if (![0, 90, 180, 270].includes(rotation)) {
    throw new UnsupportedImageError('Photos can only be turned a quarter turn at a time.')
  }
  return { x: x!, y: y!, width: width!, height: height!, rotation }
}

/**
 * The pixel region of a W×H photo to keep: the requested crop (or the whole
 * photo), clamped to the photo, then trimmed around its center to exactly
 * `aspect`.
 */
function cropRegion(W: number, H: number, aspect: number, crop: Crop | null) {
  let left = crop ? (crop.x / 100) * W : 0
  let top = crop ? (crop.y / 100) * H : 0
  let width = Math.min(crop ? (crop.width / 100) * W : W, W - left)
  let height = Math.min(crop ? (crop.height / 100) * H : H, H - top)
  if (width / height > aspect) {
    const w = height * aspect
    left += (width - w) / 2
    width = w
  } else {
    const h = width / aspect
    top += (height - h) / 2
    height = h
  }
  return {
    left: Math.max(0, Math.round(left)),
    top: Math.max(0, Math.round(top)),
    width: Math.max(1, Math.min(W, Math.round(width))),
    height: Math.max(1, Math.min(H, Math.round(height))),
  }
}

/** Output size for a region: longest edge at most MAX_EDGE, never enlarged, exactly `aspect`. */
function outputSize(region: { width: number; height: number }, aspect: number) {
  if (aspect <= 1) {
    const height = Math.min(MAX_EDGE, region.height)
    return { width: Math.max(1, Math.round(height * aspect)), height }
  }
  const width = Math.min(MAX_EDGE, region.width)
  return { width, height: Math.max(1, Math.round(width / aspect)) }
}

const readError = (err: unknown) =>
  new UnsupportedImageError(
    `That file couldn't be read as a photo (${err instanceof Error ? err.message : String(err)}).`,
  )

/**
 * The copy of an upload we keep for good, so every crop (including later
 * re-crops) starts from the full photo. Turned upright and full resolution,
 * never resized. Re-encoded once at high quality with full color detail,
 * because that's how the metadata goes: sharp drops it all unless asked, so
 * the GPS location phones embed is never stored.
 */
async function normalizeOriginal(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: 'error', autoOrient: true })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .toBuffer()
  } catch (err) {
    throw readError(err)
  }
}

/**
 * The photo the site shows, made from an upright original: cropped to the
 * collection's shape (if it has one), then shrunk. Cropping comes first, so
 * the crop never loses detail to an earlier resize.
 */
async function makeDisplay(
  original: Buffer,
  aspect: number | undefined,
  crop: Crop | null,
): Promise<{ body: Buffer; width: number; height: number }> {
  try {
    const rotation = crop?.rotation ?? 0
    // Sharp turns the photo before the extract below, so the crop box applies
    // to the turned photo, matching the crop tool.
    const img = sharp(original, { failOn: 'error' }).rotate(rotation)
    if (aspect) {
      const meta = await img.metadata()
      const sideways = rotation === 90 || rotation === 270
      const width = sideways ? meta.height : meta.width
      const height = sideways ? meta.width : meta.height
      const region = cropRegion(width, height, aspect, crop)
      img.extract(region).resize({ ...outputSize(region, aspect), fit: 'cover' })
    } else {
      img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    }
    const { data, info } = await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    return { body: data, width: info.width, height: info.height }
  } catch (err) {
    throw readError(err)
  }
}

// Collections become folder names, so keep them tame.
const SAFE_SEGMENT = /^[a-z0-9-]+$/

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * A short name from a photo's contents, e.g. "a2BcF19x": the same photo always
 * gets the same name, so re-uploading it reuses the stored files.
 */
function shortHash(body: Buffer, length: number): string {
  let n = BigInt(`0x${createHash('sha256').update(body).digest('hex')}`)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += BASE62[Number(n % 62n)]
    n /= 62n
  }
  return out
}

/**
 * Originals all share one folder, so their names need room: at 8 characters,
 * two photos landing on the same name is about a 1 in 5 million chance even
 * at 10,000 photos. A display photo only has to differ from the other crops
 * of the same original, so 6 is plenty.
 */
const ORIGINAL_NAME_LENGTH = 8
const DISPLAY_NAME_LENGTH = 6

let s3: S3Client | null = null

function s3Client(): S3Client {
  const { region, endpoint } = config.uploads
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
  return s3
}

async function store(key: string, body: Buffer): Promise<string> {
  const { bucket, publicBaseUrl, localDir, localBaseUrl } = config.uploads
  if (bucket) {
    await s3Client().send(
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

async function load(key: string): Promise<Buffer> {
  const { bucket } = config.uploads
  if (bucket) {
    try {
      const res = await s3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!res.Body) throw new Error('empty response')
      return Buffer.from(await res.Body.transformToByteArray())
    } catch (err) {
      throw new UnsupportedImageError(
        `Couldn't load the stored photo ${key} (${err instanceof Error ? err.message : String(err)}).`,
      )
    }
  }
  const file = localUploadPath(key)
  if (!file) throw new UnsupportedImageError('Unknown photo.')
  return fs.readFile(file)
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

/*
 * Storage layout (all names are content hashes, so nothing is ever overwritten):
 *
 *   {prefix}originals/{collection}/{original}.jpg     kept for re-cropping, never shown, e.g. a2BcF19x.jpg
 *   {prefix}{collection}/{original}/{display}.jpg     what the site shows, e.g. a2BcF19x/Q7mZp2.jpg
 *   {prefix}{collection}/{original}/{display}-400.jpg smaller copies of it, etc.
 *
 * A display photo's folder names its original, so a re-crop can find it.
 * Photos uploaded before originals were kept sit at {prefix}{collection}/{hash}.jpg.
 */
const originalKey = (prefix: string, collection: string, originalHash: string) =>
  `${prefix}originals/${collection}/${originalHash}.jpg`

const DISPLAY_KEY = /^(.*?)([a-z0-9-]+)\/([0-9A-Za-z]{8})\/[0-9A-Za-z]{6}\.jpg$/

async function storeDisplay(
  prefix: string,
  collection: string,
  originalHash: string,
  original: Buffer,
  crop: Crop | null,
): Promise<Uploaded> {
  const { body, width, height } = await makeDisplay(original, PHOTO_ASPECT[collection], crop)
  const key = `${prefix}${collection}/${originalHash}/${shortHash(body, DISPLAY_NAME_LENGTH)}.jpg`
  const url = await storeWithVariants(key, body)
  return { url, width, height, bytes: body.length }
}

/**
 * Keep the original of an uploaded photo, then make and store the photo the
 * site shows. `crop` picks the part to keep; collections with a fixed shape
 * are center-cropped to it when it's missing.
 */
export async function uploadImage(collection: string, input: Buffer, crop: Crop | null = null): Promise<Uploaded> {
  if (!SAFE_SEGMENT.test(collection)) throw new UnsupportedImageError('Unknown collection')
  const prefix = config.uploads.prefix
  const original = await normalizeOriginal(input)
  const originalHash = shortHash(original, ORIGINAL_NAME_LENGTH)
  await store(originalKey(prefix, collection, originalHash), original)
  return storeDisplay(prefix, collection, originalHash, original, crop)
}

/**
 * Re-crop a photo we already stored (by the URL the site shows), starting
 * from its original. Stores the result as a new photo; the old one stays put,
 * since published pages may use it.
 */
export async function recropImage(collection: string, url: string, crop: Crop): Promise<Uploaded> {
  if (!SAFE_SEGMENT.test(collection)) throw new UnsupportedImageError('Unknown collection')
  const { publicBaseUrl, localBaseUrl } = config.uploads
  const base = usingLocalUploads() ? localBaseUrl : publicBaseUrl
  if (!base || !url.startsWith(`${base}/`)) {
    throw new UnsupportedImageError('Only photos uploaded through the admin can be cropped.')
  }
  const key = url.slice(base.length + 1)
  const match = DISPLAY_KEY.exec(key)
  if (match) {
    const [, prefix = '', folder = '', originalHash = ''] = match
    const original = await load(originalKey(prefix, folder, originalHash))
    return storeDisplay(prefix, collection, originalHash, original, crop)
  }
  // Uploaded before originals were kept: the shown photo is the best we
  // have, so it becomes the original from here on.
  return uploadImage(collection, await load(key), crop)
}

/** Where to read a locally stored upload from, or null if the path is unsafe/missing. */
export function localUploadPath(key: string): string | null {
  const root = config.uploads.localDir
  const file = path.resolve(root, key)
  return file.startsWith(root + path.sep) ? file : null
}

/** True when uploads only live on this machine (no S3 configured). */
export const usingLocalUploads = () => config.uploads.bucket === null
