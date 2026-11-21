import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

export type PreviewState = 'none' | 'building' | 'ready' | 'failed'

export type PreviewStatus = {
  state: PreviewState
  /** When the current/last build started (ISO). */
  startedAt: string | null
  /** When the last build finished (ISO). */
  finishedAt: string | null
  /** True when content has been saved since the ready preview was built. */
  stale: boolean
  /** Port nginx serves the preview on; the client builds the URL from its own hostname. */
  port: number
  /** Tail of the build output, only on failure. */
  log: string[] | null
}

const LOG_LINES = 40

let state: PreviewState = 'none'
let startedAt: Date | null = null
let finishedAt: Date | null = null
let builtHash: string | null = null
let failureLog: string[] | null = null

const contentDir = () => path.join(config.siteDir, 'src', 'content')

/**
 * Fingerprint of everything in src/content. Used to tell whether the preview
 * still matches what's saved (and, later, to let Publish skip a rebuild).
 */
export async function contentHash(): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const nested = await Promise.all(
      entries.map((e) => {
        const p = path.join(dir, e.name)
        return e.isDirectory() ? walk(p) : Promise.resolve([p])
      }),
    )
    return nested.flat()
  }
  for (const file of (await walk(contentDir())).sort()) {
    hash.update(path.relative(contentDir(), file))
    hash.update('\0')
    hash.update(await fs.readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * If a preview exists from before a restart, treat it as ready but of unknown
 * freshness, and recover its build time from the files.
 */
export async function initPreview(): Promise<void> {
  const index = path.join(config.previewDir, 'index.html')
  if (!existsSync(index)) return
  state = 'ready'
  finishedAt = (await fs.stat(index)).mtime
}

export async function getPreviewStatus(): Promise<PreviewStatus> {
  const stale = state === 'ready' && (builtHash === null || builtHash !== (await contentHash()))
  return {
    state,
    startedAt: startedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
    stale,
    port: config.previewPort,
    log: state === 'failed' ? failureLog : null,
  }
}

let running: Promise<void> | null = null

function kickOff(): Promise<void> {
  if (!running) {
    state = 'building'
    startedAt = new Date()
    failureLog = null
    running = build().finally(() => {
      running = null
    })
  }
  return running
}

/** Kick off a build unless one is already running. Returns immediately. */
export async function startPreview(): Promise<PreviewStatus> {
  void kickOff()
  return getPreviewStatus()
}

export class BuildFailedError extends Error {
  constructor(public readonly log: string[]) {
    super('The site failed to build')
  }
}

/**
 * Make sure the preview reflects exactly what's saved right now: wait for any
 * running build, then rebuild only if content changed since. Throws if the
 * build fails. Publish uses this as its pre-push check.
 */
export async function ensureFreshBuild(): Promise<void> {
  if (running) await running
  if (state !== 'ready' || builtHash !== (await contentHash())) await kickOff()
  if (state !== 'ready') throw new BuildFailedError(failureLog ?? [])
}

async function build(): Promise<void> {
  const next = `${config.previewDir}-next`
  const old = `${config.previewDir}-old`
  const tail: string[] = []

  try {
    const hash = await contentHash()
    await fs.rm(next, { recursive: true, force: true })

    const astro = path.join(config.siteDir, 'node_modules', '.bin', 'astro')
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(astro, ['build', '--outDir', next], {
        cwd: config.siteDir,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      })
      const collect = (chunk: Buffer) => {
        for (const raw of chunk.toString().split('\n')) {
          // Astro colors output regardless of FORCE_COLOR; strip ANSI codes and
          // stack frames so the tail shows the human-readable error.
          // eslint-disable-next-line no-control-regex
          const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
          if (!line.trim() || /^\s+at /.test(line)) continue
          tail.push(line)
          if (tail.length > LOG_LINES) tail.shift()
        }
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.on('error', reject)
      child.on('close', (c) => resolve(c ?? 1))
    })
    if (code !== 0) throw new Error(`astro build exited with code ${code}`)

    // Swap the finished build into place so nginx never serves a half-built site.
    await fs.rm(old, { recursive: true, force: true })
    if (existsSync(config.previewDir)) await fs.rename(config.previewDir, old)
    await fs.rename(next, config.previewDir)
    await fs.rm(old, { recursive: true, force: true })

    builtHash = hash
    state = 'ready'
    console.log(`Preview built in ${Date.now() - (startedAt?.getTime() ?? Date.now())}ms`)
  } catch (err) {
    console.error('Preview build failed:', err)
    tail.push(String(err))
    failureLog = tail.slice(-LOG_LINES)
    state = 'failed'
    await fs.rm(next, { recursive: true, force: true }).catch(() => {})
  } finally {
    finishedAt = new Date()
  }
}
