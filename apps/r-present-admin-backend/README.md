# r-present-admin-backend

Small Node API (Hono) for [`r-present-admin`](../r-present-admin). It reads and writes
`src/content/` in a checkout of [`r-present-website`](../r-present-website), builds
previews, and publishes (commit + push to `main`, which triggers the GitHub Pages deploy).

```sh
npm install
npm run dev     # http://localhost:8787/api/health
npm run build && npm start
```

## Environment

| Var        | Default                     | Purpose                                |
| ---------- | --------------------------- | -------------------------------------- |
| `PORT`     | `8787`                      | HTTP port                              |
| `SITE_DIR` | `../r-present-website`      | Site app whose `src/content/` we edit  |
| `PREVIEW_DIR` | `<repo>/.preview`        | Where preview builds land               |
| `PREVIEW_PORT` | `8081`                  | Port the preview is served on (by nginx) |
| `PUBLISH_REMOTE` | `origin`              | Remote Publish pushes to                 |
| `PUBLISH_BRANCH` | `main`                | Branch Publish pushes to                 |
| `PUBLISH_AUTHOR_NAME` | `R. Present Admin` | Commit author for published changes  |
| `PUBLISH_AUTHOR_EMAIL` | `admin@r-present.com` | Commit author email               |

## API

| Method | Path                                         | What                                                    |
| ------ | -------------------------------------------- | ------------------------------------------------------- |
| GET    | `/api/health`                                | Liveness + which site dir is being edited               |
| GET    | `/api/collections`                           | Collection names + JSON Schemas                         |
| GET    | `/api/collections/:collection/entries`       | All entries (`{ id, data }`) in a collection            |
| PUT    | `/api/collections/:collection/entries/:id`   | Validate + overwrite an existing entry (400 w/ `errors`) |
| GET    | `/api/preview`                               | Preview build status (`none`/`building`/`ready`/`failed`, `stale`) |
| POST   | `/api/preview`                               | Start a preview build (no-op if one is running)         |
| GET    | `/api/changes`                               | Saved content entries that differ from what's published |
| GET    | `/api/publish`                               | Publish status (`idle`/`publishing`/`published`/`failed`) |
| POST   | `/api/publish`                               | Start publishing (no-op if one is running)              |

Schemas come from the JSON Schema files Astro generates in the site's `.astro/collections/`
(the backend runs `astro sync` if they're missing), so the site's `src/content/config.ts`
is the single source of truth. Saved files are formatted with the site's own Prettier and
keep their existing key order, so diffs only show real changes.

## Publishing

`POST /api/publish` puts a content-only commit on top of the latest `origin/main` and pushes
it. That triggers the GitHub Pages deploy. It doesn't depend on which branch this checkout has
checked out, and it never touches the checkout's index or HEAD.

1. **Sync.** Fetches `main` into a side ref. Content files changed on GitHub since the last
   publish are copied into the working tree. If the same file was also edited here and the
   two versions differ, it stops with a conflict and changes nothing. Retrying keeps refusing
   until someone resolves it.
2. **Build.** Runs `astro build`, or reuses the preview if it already matches the saved content.
   A failing build blocks the publish.
3. **Commit + push.** Builds the commit's tree in a throwaway index (latest `main` + the
   working tree's `src/content/`), runs `commit-tree`, then pushes without force.
4. Records the pushed commit in `refs/r-present-admin/published`. That's a private ref, so a
   stray `git fetch`/`git pull` can't move it and hide a conflict. `/api/changes` diffs
   against it.

Saves return 409 while a publish is running.
