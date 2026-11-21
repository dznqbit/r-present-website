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

## API

| Method | Path                                         | What                                                    |
| ------ | -------------------------------------------- | ------------------------------------------------------- |
| GET    | `/api/health`                                | Liveness + which site dir is being edited               |
| GET    | `/api/collections`                           | Collection names + JSON Schemas                         |
| GET    | `/api/collections/:collection/entries`       | All entries (`{ id, data }`) in a collection            |
| PUT    | `/api/collections/:collection/entries/:id`   | Validate + overwrite an existing entry (400 w/ `errors`) |

Schemas come from the JSON Schema files Astro generates in the site's `.astro/collections/`
(the backend runs `astro sync` if they're missing), so the site's `src/content/config.ts`
is the single source of truth. Saved files are formatted with the site's own Prettier and
keep their existing key order, so diffs only show real changes.
