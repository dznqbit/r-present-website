import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { config } from './config.js'
import {
  commitChanges,
  CONTENT_PATHSPEC,
  git,
  publishedRef,
  commitBlob,
  revParse,
  workingChangesAgainst,
  worktreeBlob,
  type PathChange,
} from './git.js'
import { BuildFailedError, ensureFreshBuild } from './preview.js'

export type PublishState = 'idle' | 'publishing' | 'published' | 'failed'

export type PublishStatus = {
  state: PublishState
  /** Human-readable step while publishing. */
  step: string | null
  startedAt: string | null
  finishedAt: string | null
  /** The commit pushed by the last successful publish. */
  commit: { sha: string; url: string | null } | null
  /** What went wrong, in words she can act on. */
  error: string | null
  /** Build output or git stderr for the curious. */
  log: string[] | null
}

let state: PublishState = 'idle'
let step: string | null = null
let startedAt: Date | null = null
let finishedAt: Date | null = null
let commit: PublishStatus['commit'] = null
let error: string | null = null
let log: string[] | null = null

export const isPublishing = () => state === 'publishing'

export function getPublishStatus(): PublishStatus {
  return {
    state,
    step,
    startedAt: startedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
    commit,
    error,
    log,
  }
}

/** Start publishing unless already in progress. Returns immediately. */
export function startPublish(): PublishStatus {
  if (state !== 'publishing') {
    state = 'publishing'
    step = 'Starting'
    startedAt = new Date()
    finishedAt = null
    error = null
    log = null
    void publish()
  }
  return getPublishStatus()
}

/** A failure we can explain to a non-developer. */
class PublishError extends Error {
  constructor(
    message: string,
    public readonly detail: string[] | null = null,
  ) {
    super(message)
  }
}

async function publish(): Promise<void> {
  try {
    // 1. Get the latest published state from GitHub, and bring down any content
    //    edited there so publishing never undoes someone else's change.
    step = 'Checking GitHub for updates'
    const before = await revParse(publishedRef())
    const localEdits = await workingChangesAgainst(before)
    const latest = await fetchLatest()
    await syncRemoteContent(before, latest, localEdits)
    // Only now that her edits and GitHub's are reconciled do we move our notion
    // of "published" forward. On a conflict it stays put, so a retry still sees
    // the conflict instead of silently overwriting GitHub's version.
    await git(['update-ref', publishedRef(), latest])

    // 2. Anything left to publish?
    const pending = await workingChangesAgainst(latest)
    if (pending.length === 0) throw new PublishError('Nothing to publish. Everything is already live.')
    await refuseLocalPhotos(pending)

    // 3. Never push something that doesn't build.
    step = 'Building the site'
    await ensureFreshBuild()

    // 4. Commit just the content directory on top of the latest main, without
    //    touching whatever branch this checkout happens to be on.
    step = 'Saving to GitHub'
    const sha = await commitContent(latest, pending)
    await push(sha)
    // Record that this is now what's published, so "unpublished changes" clears.
    await git(['update-ref', publishedRef(), sha])

    commit = { sha, url: await commitUrl(sha) }
    state = 'published'
    console.log(`Published ${sha}`)
  } catch (err) {
    state = 'failed'
    if (err instanceof PublishError) {
      error = err.message
      log = err.detail
    } else if (err instanceof BuildFailedError) {
      error = "The site didn't build, so nothing was published. Check the details, fix the entry, and try again."
      log = err.log
    } else {
      console.error('Publish failed:', err)
      error = 'Something went wrong while publishing.'
      log = [String(err)]
    }
  } finally {
    step = null
    finishedAt = new Date()
  }
}

/** Fetch GitHub's main into a side ref (not the published ref) and return its sha. */
async function fetchLatest(): Promise<string> {
  const { remote, branch } = config.publish
  const incoming = 'refs/r-present-admin/incoming'
  try {
    await git(['fetch', '--quiet', remote, `+refs/heads/${branch}:${incoming}`])
  } catch (err) {
    throw new PublishError("Couldn't reach GitHub. Is the internet connection up?", [stderrOf(err)])
  }
  return revParse(incoming)
}

/**
 * Copy content that changed on GitHub (between `before` and `latest`) into the
 * working tree, unless it was also edited here, which is a conflict we refuse
 * to guess about.
 */
async function syncRemoteContent(
  before: string,
  latest: string,
  localEdits: PathChange[],
): Promise<void> {
  const remote = await commitChanges(before, latest)
  if (remote.length === 0) return

  const local = new Set(localEdits.map((c) => c.path))
  const conflicts: string[] = []
  const toSync: PathChange[] = []
  for (const c of remote) {
    if (!local.has(c.path)) {
      toSync.push(c)
      continue
    }
    // Edited on both sides. Fine only if both sides already agree (e.g. a
    // `git pull` brought GitHub's version down); otherwise it's a real conflict.
    const [mine, theirs] = await Promise.all([worktreeBlob(c.path), commitBlob(latest, c.path)])
    if (mine !== theirs) conflicts.push(c.path)
  }
  if (conflicts.length > 0) {
    throw new PublishError(
      'Some entries were also changed on GitHub since you started editing. Ask for help merging them.',
      conflicts,
    )
  }

  for (const { path: rel, change } of toSync) {
    const file = path.join(config.siteDir, rel)
    if (change === 'deleted') {
      await fs.rm(file, { force: true })
    } else {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, await git(['show', `${latest}:./${rel}`]))
    }
  }
}

/**
 * Photos uploaded without S3 only exist on this machine. Publishing an entry
 * that points at one would put a broken image on the live site.
 */
async function refuseLocalPhotos(pending: PathChange[]): Promise<void> {
  const local = config.uploads.localBaseUrl
  const offenders: string[] = []
  for (const { path: rel, change } of pending) {
    if (change === 'deleted') continue
    const text = await fs.readFile(path.join(config.siteDir, rel), 'utf8')
    if (text.includes(local)) offenders.push(rel)
  }
  if (offenders.length > 0) {
    throw new PublishError(
      "Some photos were only saved on this computer, not uploaded to the image server, so they'd be broken on the live site.",
      offenders,
    )
  }
}

async function commitContent(parent: string, pending: PathChange[]): Promise<string> {
  // A throwaway index lets us build the commit's tree from `parent` plus the
  // working tree's content dir, without disturbing the checkout's real index.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'r-present-publish-'))
  const env = {
    GIT_INDEX_FILE: path.join(tmp, 'index'),
    GIT_AUTHOR_NAME: config.publish.authorName,
    GIT_AUTHOR_EMAIL: config.publish.authorEmail,
    GIT_COMMITTER_NAME: config.publish.authorName,
    GIT_COMMITTER_EMAIL: config.publish.authorEmail,
  }
  try {
    await git(['read-tree', parent], env)
    await git(['add', '--all', '--', CONTENT_PATHSPEC], env)
    const tree = (await git(['write-tree'], env)).trim()
    return (await git(['commit-tree', tree, '-p', parent, '-m', commitMessage(pending)], env)).trim()
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

function commitMessage(pending: PathChange[]): string {
  const names = pending.map((c) => ({
    ...c,
    name: c.path.replace(/^src\/content\//, '').replace(/\.json$/, ''),
  }))
  const only = names[0]
  const title =
    names.length === 1 && only ? `Update ${only.name}` : `Update ${names.length} content entries`
  const body = names.map((c) => `- ${c.change} ${c.name}`).join('\n')
  return `${title}\n\n${body}\n\nPublished from the R. Present admin.`
}

async function push(sha: string): Promise<void> {
  const { remote, branch } = config.publish
  try {
    // No force: if main moved since our fetch, the push is rejected and she can retry.
    await git(['push', '--quiet', remote, `${sha}:refs/heads/${branch}`])
  } catch (err) {
    const stderr = stderrOf(err)
    if (/protected branch|GH013|rule violations|pull request/i.test(stderr)) {
      throw new PublishError(
        `GitHub refused the push because "${branch}" only accepts pull requests. Add deploy keys to the ruleset's bypass list.`,
        [stderr],
      )
    }
    if (/non-fast-forward|fetch first|rejected/i.test(stderr)) {
      throw new PublishError('The site changed on GitHub while publishing. Try again.', [stderr])
    }
    throw new PublishError("Couldn't save to GitHub.", [stderr])
  }
}

/** https://github.com/<owner>/<repo>/commit/<sha>, when the remote is on GitHub. */
async function commitUrl(sha: string): Promise<string | null> {
  try {
    const url = (await git(['remote', 'get-url', config.publish.remote])).trim()
    const slug = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1]
    // The Pi uses an SSH host alias (git@github-r-present:owner/repo.git).
    const aliased = /^git@github-[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1]
    const repo = slug ?? aliased
    return repo ? `https://github.com/${repo}/commit/${sha}` : null
  } catch {
    return null
  }
}

function stderrOf(err: unknown): string {
  const stderr = (err as { stderr?: unknown }).stderr
  return typeof stderr === 'string' && stderr.trim() ? stderr.trim() : String(err)
}
