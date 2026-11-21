# r-present-admin

Local admin SPA (Vite + React) for editing R. Present site content. It talks to
[`r-present-admin-backend`](../r-present-admin-backend) over `/api`.

```sh
npm install
npm run dev    # http://localhost:5173, proxies /api → localhost:8787
npm run build  # static output in dist/, served by nginx on the Pi
```
