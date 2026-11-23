import { publishedRef, workingChangesAgainst, type ChangeKind } from './git.js'

export type Change = {
  collection: string
  id: string
  change: ChangeKind
}

const CONTENT_PATH = /^src\/content\/([^/]+)\/([^/]+)\.json$/

/**
 * Content entries whose saved files differ from what's published (the last
 * fetched GitHub main), i.e. edits that aren't live yet.
 */
export async function listChanges(): Promise<Change[]> {
  const changes: Change[] = []
  for (const { path, change } of await workingChangesAgainst(publishedRef())) {
    const match = CONTENT_PATH.exec(path)
    if (!match) continue
    const [, collection = '', id = ''] = match
    changes.push({ collection, id, change })
  }
  return changes
}
