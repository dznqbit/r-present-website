import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'

const run = promisify(execFile)

export type Change = {
  collection: string
  id: string
  change: 'modified' | 'added' | 'deleted'
}

const CONTENT_PATH = /(?:^|\/)src\/content\/([^/]+)\/([^/]+)\.json$/

/**
 * Content entries whose saved files differ from the last commit, i.e. edits
 * that haven't been published yet.
 */
export async function listChanges(): Promise<Change[]> {
  const { stdout } = await run(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'src/content'],
    { cwd: config.siteDir },
  )

  const tokens = stdout.split('\0').filter(Boolean)
  const changes: Change[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    const xy = token.slice(0, 2)
    const file = token.slice(3)
    // Renames/copies are followed by an extra token holding the original path.
    if (xy.includes('R') || xy.includes('C')) i++

    const match = CONTENT_PATH.exec(file)
    if (!match) continue
    const [, collection = '', id = ''] = match
    const change = xy === '??' || xy.includes('A') ? 'added' : xy.includes('D') ? 'deleted' : 'modified'
    changes.push({ collection, id, change })
  }
  return changes
}
