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

```sh
ssh 192.168.0.16 /srv/r-present/repo/devops/pi/deploy.sh
```

It stops without changing anything if the admin has unpublished changes. Publish them, or click **Discard…** in the admin to throw them away, then run it again.

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
