# R. Present

Monorepo for R. Present, a Seattle handmade jewelry business.

| Path                            | What                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| `apps/r-present-website`        | Public Astro site → GitHub Pages at https://r-present.com    |
| `apps/r-present-admin`          | Local admin SPA (Vite + React) for editing site content      |
| `apps/r-present-admin-backend`  | Node API: edits content, builds previews, publishes via git  |
| `devops`                        | Deployment config for the admin stack on the Raspberry Pi    |

Each app is independent: `cd` into it and `npm install`.
