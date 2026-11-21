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
