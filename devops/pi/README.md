# Raspberry Pi deployment

The admin runs on the Pi 3 at **192.168.0.16** (also running Pi-hole and nginx).
Open it at **http://192.168.0.16:8080/**. Draft previews show up at **http://192.168.0.16:8081/**.

| Piece      | Where                                                           |
| ---------- | --------------------------------------------------------------- |
| Node 24    | `/opt/node` (official tarball, not apt)                         |
| Repo clone | `/srv/r-present/repo`, cloned via `git@github-r-present:…`      |
| Backend    | systemd `r-present-admin-backend` on port `8787`                 |
| Admin SPA  | nginx `:8080` serves `apps/r-present-admin/dist`, proxies `/api` |
| Preview    | nginx `:8081` serves `/srv/r-present/repo/.preview` (built by the admin) |

The `github-r-present` SSH host alias (in `~/.ssh/config` on the Pi) uses the
deploy key `~/.ssh/r-present-deploy`. That key has write access to this repo only.

## Updating

The Pi runs whatever is on GitHub's `main`, so merge your changes first. Then,
from your laptop:

```sh
ssh 192.168.0.16 /srv/r-present/repo/devops/pi/deploy.sh
```

`deploy.sh` pulls `main`, reinstalls packages, rebuilds the backend and the
admin, and restarts the backend. It takes a couple of minutes and ends with
`Deployed <sha>`.

It stops without changing anything if the admin has unpublished changes.
Publish them, or click **Discard…** in the admin to throw them away, then run it
again.

If the deploy changed either of these files, install it by hand, because
`deploy.sh` doesn't:

```sh
# systemd unit
ssh 192.168.0.16 'cd /srv/r-present/repo &&
  sudo install -m 644 devops/pi/r-present-admin-backend.service /etc/systemd/system/ &&
  sudo systemctl daemon-reload && sudo systemctl restart r-present-admin-backend'

# nginx config
ssh 192.168.0.16 'cd /srv/r-present/repo &&
  sudo install -m 644 devops/pi/r-present-admin.nginx.conf /etc/nginx/sites-available/r-present-admin &&
  sudo nginx -t && sudo systemctl reload nginx'
```

To check that it's up:

```sh
ssh 192.168.0.16 'systemctl is-active r-present-admin-backend && curl -s localhost:8080/api/health'
```

## First-time setup (already done)

1. Install Node 24 to `/opt/node`.
2. `git clone git@github-r-present:dznqbit/r-present-website.git /srv/r-present/repo`
3. Copy `r-present-admin-backend.service` to `/etc/systemd/system/`, then run
   `systemctl enable --now r-present-admin-backend`.
4. Copy `r-present-admin.nginx.conf` to `/etc/nginx/sites-available/r-present-admin`,
   symlink it into `sites-enabled`, then run `nginx -t && systemctl reload nginx`.
5. Run `deploy.sh`.

## Logs

```sh
journalctl -u r-present-admin-backend -f
```
