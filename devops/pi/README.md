# Raspberry Pi deployment

The admin runs on the Pi 3 at **192.168.0.15**, wired Ethernet only (also running
Pi-hole and nginx). On the home network, open it at **https://admin.r-present.com**.
Draft previews show up at **https://preview.r-present.com**. The old addresses,
http://192.168.0.15:8080/ and :8081/, still work as a fallback.

The router reserves .15 for the Pi's Ethernet port. The Pi's Wi-Fi is off: with
both on the same network, the two ports kept knocking each other's address off.

| Piece      | Where                                                           |
| ---------- | --------------------------------------------------------------- |
| Node 24    | `/opt/node` (official tarball, not apt)                         |
| Repo clone | `/srv/r-present/repo`, cloned via `git@github-r-present:…`      |
| Backend    | systemd `r-present-admin-backend` on port `8787`                 |
| Admin SPA  | nginx `admin.r-present.com` (`:443`) and `:8080` serve `apps/r-present-admin/dist`, proxy `/api` |
| Preview    | nginx `preview.r-present.com` (`:443`) and `:8081` serve `/srv/r-present/repo/.preview` (built by the admin) |
| HTTPS cert | `/etc/letsencrypt/live/admin.r-present.com/`, covers both names; renews itself |

The `github-r-present` SSH host alias (in `~/.ssh/config` on the Pi) uses the
deploy key `~/.ssh/r-present-deploy`. That key has write access to this repo only.

## Updating

The Pi runs whatever is on GitHub's `main`, so merge your changes first. Then,
from your laptop:

```sh
ssh pi-hole /srv/r-present/repo/devops/pi/deploy.sh
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
ssh pi-hole 'cd /srv/r-present/repo &&
  sudo install -m 644 devops/pi/r-present-admin-backend.service /etc/systemd/system/ &&
  sudo systemctl daemon-reload && sudo systemctl restart r-present-admin-backend'

# nginx config
ssh pi-hole 'cd /srv/r-present/repo &&
  sudo install -m 644 devops/pi/r-present-admin.nginx.conf /etc/nginx/sites-available/r-present-admin &&
  sudo nginx -t && sudo systemctl reload nginx'
```

To check that it's up:

```sh
ssh pi-hole 'systemctl is-active r-present-admin-backend && curl -s localhost:8080/api/health'
```

## First-time setup (already done)

1. Install Node 24 to `/opt/node`.
2. `git clone git@github-r-present:dznqbit/r-present-website.git /srv/r-present/repo`
3. Copy `r-present-admin-backend.service` to `/etc/systemd/system/`, then run
   `systemctl enable --now r-present-admin-backend`.
4. Copy `r-present-admin.nginx.conf` to `/etc/nginx/sites-available/r-present-admin`,
   symlink it into `sites-enabled`, then run `nginx -t && systemctl reload nginx`.
5. Run `deploy.sh`.

## Shared nginx

nginx on this Pi isn't only ours: it also serves Pi-hole's web admin and the
Yesler dashboard, which come from another repo. **`/etc/nginx/README.md` on the
Pi** maps every site, port, hostname, cert and renewal hook, plus the rules for
changing them. Read it before touching nginx. **Whenever you change
`r-present-admin.nginx.conf`'s ports, hostnames or certs, or add anything
nginx-related, update that README in the same session** (`sudo nano
/etc/nginx/README.md`), including its "Last updated" line.

## HTTPS names (already done)

`admin.r-present.com` and `preview.r-present.com` are **DNS-only** A records in
Cloudflare pointing at `192.168.0.15`. They have to be DNS-only: Cloudflare's
proxy can't reach a home address. Since they point at a home address, they only
work on the home network.

The certificate comes from Let's Encrypt using certbot's Cloudflare DNS plugin,
so nothing has to be reachable from the internet. It uses the same Cloudflare
token as the Yesler certs (`~/.secrets/cloudflare.ini`, DNS edit on both
r-present.com and yesler.casa):

```sh
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /home/dznqbit/.secrets/cloudflare.ini \
  --cert-name admin.r-present.com -d admin.r-present.com -d preview.r-present.com
```

certbot's timer renews it. The deploy hook in
`/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` reloads nginx after
any renewal.

## Logs

```sh
journalctl -u r-present-admin-backend -f
```
