import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'

const run = promisify(execFile)

/** Run git in the site app directory; returns stdout. */
export async function git(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd: config.siteDir,
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/**
 * The commit we last published or synced with. A private ref, deliberately not
 * refs/remotes/origin/main, because any `git fetch`/`git pull` (including
 * opportunistic updates during our own fetches) moves that one, which would
 * hide conflicts.
 */
export const publishedRef = () => 'refs/r-present-admin/published'

/** On first run, start "published" at the checkout's view of <remote>/<branch>. */
export async function initPublishedRef(): Promise<void> {
  try {
    await revParse(publishedRef())
  } catch {
    const tracking = `refs/remotes/${config.publish.remote}/${config.publish.branch}`
    await git(['update-ref', publishedRef(), await revParse(tracking)])
  }
}

/** Blob id of a working-tree file, or null if it doesn't exist. */
export async function worktreeBlob(relPath: string): Promise<string | null> {
  try {
    return (await git(['hash-object', '--', relPath])).trim()
  } catch {
    return null
  }
}

/** Blob id of a path at a commit, or null if it doesn't exist there. */
export async function commitBlob(rev: string, relPath: string): Promise<string | null> {
  try {
    return await revParse(`${rev}:./${relPath}`)
  } catch {
    return null
  }
}

export const CONTENT_PATHSPEC = 'src/content'

export type ChangeKind = 'modified' | 'added' | 'deleted'
/** Paths are relative to the site app dir, e.g. src/content/products/foo.json */
export type PathChange = { path: string; change: ChangeKind }

const kindFor = (status: string): ChangeKind =>
  status.startsWith('A') ? 'added' : status.startsWith('D') ? 'deleted' : 'modified'

/** Parse `git diff --name-status -z` output. */
function parseNameStatus(out: string): PathChange[] {
  const tokens = out.split('\0').filter(Boolean)
  const result: PathChange[] = []
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i] ?? ''
    // Renames/copies carry two paths: old then new. Treat as delete + add.
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = tokens[++i] ?? ''
      const to = tokens[++i] ?? ''
      if (status.startsWith('R')) result.push({ path: from, change: 'deleted' })
      result.push({ path: to, change: 'added' })
      continue
    }
    result.push({ path: tokens[++i] ?? '', change: kindFor(status) })
  }
  return result
}

/** Content files in the working tree that differ from `rev`, including new files. */
export async function workingChangesAgainst(rev: string): Promise<PathChange[]> {
  const tracked = parseNameStatus(
    await git(['diff', '--name-status', '--relative', '--no-renames', '-z', rev, '--', CONTENT_PATHSPEC]),
  )
  const untracked = (
    await git(['ls-files', '--others', '--exclude-standard', '-z', '--', CONTENT_PATHSPEC])
  )
    .split('\0')
    .filter(Boolean)
    .map((path): PathChange => ({ path, change: 'added' }))
  return [...tracked, ...untracked]
}

/** Content files that differ between two commits. */
export async function commitChanges(from: string, to: string): Promise<PathChange[]> {
  if (from === to) return []
  return parseNameStatus(
    await git(['diff', '--name-status', '--relative', '--no-renames', '-z', from, to, '--', CONTENT_PATHSPEC]),
  )
}

export async function revParse(rev: string): Promise<string> {
  return (await git(['rev-parse', '--verify', rev])).trim()
}
