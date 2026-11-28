# R. Present

Monorepo for R. Present, a Seattle handmade jewelry business.

| Path                            | What                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| `apps/r-present-website`        | Public Astro site → GitHub Pages at https://r-present.com    |
| `apps/r-present-admin`          | Local admin SPA (Vite + React) for editing site content      |
| `apps/r-present-admin-backend`  | Node API: edits content, builds previews, publishes via git  |
| `devops`                        | Deployment config for the admin stack on the Raspberry Pi    |

Each app is independent: `cd` into it and `npm install`.

## Running the app locally

```sh
# 1. Website UI: http://localhost:4321
cd apps/r-present-website && npm run dev
```

## Running the admin locally

Three processes, one terminal tab each, all from the repo root (run `npm install` in each app first):

```sh
# 1. Backend API: http://localhost:8787/api/health
cd apps/r-present-admin-backend && npm run dev

# 2. Admin UI: http://localhost:5173 (proxies /api to the backend)
cd apps/r-present-admin && npm run dev

# 3. Preview server: http://localhost:8081 (what the Preview button links to)
mkdir -p .preview && python3 -m http.server 8081 --directory .preview
```

Things to know:

- The backend edits the real files in `apps/r-present-website/src/content/`. Use `git diff` to see what it changed.
- **Publish pushes to GitHub `main` with your own git credentials**, which deploys r-present.com. Use **Discard…** to throw away test edits instead.
- Without `S3_BUCKET`, uploaded photos are saved to `.uploads/` and only work on this machine; Publish refuses entries that use them. To upload to Cloudflare R2 instead (into `dev/`, kept apart from real photos), copy `apps/r-present-admin-backend/.env.example` to `.env` in the same folder and fill in the dev token (see [docs/plans/cloudflare-migration.md](docs/plans/cloudflare-migration.md), step 5). `npm run dev` picks it up.

On the Pi, nginx plays the role of steps 2 and 3.

## Deploying the admin to the Pi

The admin runs on the Raspberry Pi at https://admin.r-present.com (home network only) and tracks `main`. Merge to `main`, then:

```sh
ssh pi-hole /srv/r-present/repo/devops/pi/deploy.sh
```

It refuses to run while the admin has unpublished changes (Publish or **Discard…** them first). Changes to the systemd unit or nginx config need one extra step. Details, logs and first-time setup are in [`devops/pi/README.md`](devops/pi/README.md).
