# Move DNS and photos to Cloudflare

_Written 2026-11-27._

AWS still hasn't verified the account for CloudFront after 5 days, and
CloudFront was the only way to serve photos from S3 at `images.r-present.com`.
This plan drops AWS for photos and uses Cloudflare instead:

- **DNS** for r-present.com moves from Namecheap's nameservers to Cloudflare.
  Namecheap stays the registrar.
- **Photos** go in a **Cloudflare R2** bucket, served at
  `https://images.r-present.com`. R2 speaks the S3 API, so the backend's upload
  code stays the same apart from an endpoint setting (`S3_ENDPOINT`, added on
  this branch).
- **Email:** none. r-present.com doesn't use email, so the Namecheap forwarding
  records are dropped rather than moved.
- **The site** stays on GitHub Pages. Only its DNS records move.

Everything here is on Cloudflare's free plan. R2 is free up to 10 GB stored,
and downloads are always free.

## Status

| # | Step | Who | Blocked on |
|---|------|-----|------------|
| 1 | ~~Add r-present.com to Cloudflare and check the records~~ ✅ | Q | none |
| 2 | ~~Switch nameservers at Namecheap~~ ✅ 2026-11-27 | Q | 1 |
| 3 | ~~Check the site~~ ✅ (GitHub Pages settings still to eyeball) | Q + Claude | 2 |
| 4 | ~~Create the R2 bucket and connect `images.r-present.com`~~ ✅ | Q | 2 |
| 5 | ~~Create R2 tokens; put the Pi's on the Pi~~ ✅ | Q | 4 |
| 6 | Test uploads (~~laptop~~ ✅, then Pi, then iPhone) | Claude + Q | 5 |
| 7 | Tear down the AWS pieces | Q + Claude | 6 |

Steps 1–3 are the only risky part, because the site depends on DNS. Everything after that is additive.

---

## 1. Add the site to Cloudflare

Cloudflare dashboard → **Add a domain** → `r-present.com` → **Free** plan.
Let it scan the existing records, then compare its list with what's live today
(checked 2026-11-27 with `dig`):

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `@` | `185.199.108.153` | **DNS only** |
| A | `@` | `185.199.109.153` | **DNS only** |
| A | `@` | `185.199.110.153` | **DNS only** |
| A | `@` | `185.199.111.153` | **DNS only** |
| CNAME | `www` | `dznqbit.github.io` | **DNS only** |

**Delete** the imported email records: the five MX records
(`eforward1`–`eforward5.registrar-servers.com`) and the TXT
`v=spf1 include:spf.efwd.registrar-servers.com ~all`. They're for Namecheap's
email forwarding, which stops working once Namecheap's nameservers are out, and
nobody uses the email. Optionally add a TXT on `@` with `v=spf1 -all`, which
says the domain never sends mail, so spammers can't easily forge it.

**The GitHub Pages records must be "DNS only" (grey cloud), not proxied.** When
they're proxied, GitHub can't renew its HTTPS certificate for r-present.com, and
the site eventually breaks. That's the same kind of failure as the CNAME outage
on 2026-11-20.

Skip the ACM validation CNAME (`_ab0cf…images`) if Cloudflare imports it. It
was only for the AWS certificate, which step 7 removes.

Don't change the nameservers yet.

## 2. Switch nameservers

Namecheap → Domain List → r-present.com → **Nameservers** → **Custom DNS** →
enter the two nameservers Cloudflare shows (something like
`xxx.ns.cloudflare.com`). Save.

The change usually takes effect within an hour but can take up to a day.
Cloudflare emails you when the zone is active.

## 3. Check the site

```sh
dig +short NS r-present.com          # should show *.ns.cloudflare.com
dig +short r-present.com             # the four 185.199.x.153 addresses
curl -sI https://r-present.com | head -1    # HTTP/2 200
curl -sI https://www.r-present.com | head -1
```

Also check:

- GitHub → repo Settings → **Pages**: the custom domain should still say the DNS
  check passed, with HTTPS enforced.

If the site breaks, the quickest fix is switching Namecheap back to **Namecheap
BasicDNS**. Its old records are still there.

## 4. R2 bucket

Cloudflare → **R2** (it asks for a payment method even on the free tier) →
**Create bucket**:

- Name: `r-present-images`
- Location: automatic, or the hint **Western North America**

Then go to the bucket → **Settings**:

- **Custom Domains** → Connect domain → `images.r-present.com`. Cloudflare adds
  the DNS record and the certificate itself.
- Leave the **r2.dev** public URL **disabled**. Photos should only be served
  from `images.r-present.com`.

## 5. R2 tokens

R2 → **Manage API tokens** → **Create API token**. Make two:

| Token | Permission | Bucket | TTL |
|-------|------------|--------|-----|
| `r-present-admin-pi` | Object Read & Write | `r-present-images` only | forever |
| `r-present-admin-dev` | Object Read & Write | `r-present-images` only | 30 days |

Each one shows an **Access Key ID** and a **Secret Access Key** once. Never
paste them into chat or commit them anywhere.

Also note the **account ID**, which is shown on the R2 overview page. It isn't
secret. The endpoint is `https://<account-id>.r2.cloudflarestorage.com`.

**Put the Pi token on the Pi.** Run this in your own terminal. It prompts for
each value, and the secret isn't echoed:

```sh
ssh -t 192.168.0.16 '
  read -rp "R2 account ID: " acct
  read -rp "Access key ID: " id
  read -rsp "Secret access key: " secret; echo
  sudo install -m 600 -o root -g root /dev/null /etc/r-present-admin.env
  printf "%s\n" \
    "S3_BUCKET=r-present-images" \
    "S3_REGION=auto" \
    "S3_ENDPOINT=https://$acct.r2.cloudflarestorage.com" \
    "IMAGES_BASE_URL=https://images.r-present.com" \
    "AWS_ACCESS_KEY_ID=$id" \
    "AWS_SECRET_ACCESS_KEY=$secret" |
    sudo tee /etc/r-present-admin.env >/dev/null
  sudo systemctl restart r-present-admin-backend
  sudo grep -c = /etc/r-present-admin.env'
```

The last line should print `6`. (The variables are still called `AWS_*`
because the S3 SDK reads them under those names.)

**Put the dev token on the laptop** in the backend's `.env`, which is
gitignored and loaded by `npm run dev`:

```sh
cd apps/r-present-admin-backend
cp .env.example .env && chmod 600 .env
```

Then fill in the account ID and the dev token's two keys.

## 6. Test uploads

**Laptop.** Uploads go under `dev/` so they stay separate from real photos:

```sh
cd apps/r-present-admin-backend
npm run dev
```

Upload a photo in the local admin, then check:

- `curl -sI https://images.r-present.com/dev/products/<hash>.jpg` returns
  **200**, with `content-type: image/jpeg` and the long `cache-control`.
- The photo shows in the admin and in a Preview build.

Use **Discard…** afterwards; don't Publish a test entry.

**Pi.** Add a photo to an entry, save it, and Preview it. Then Discard.

**iPhone.** Add a photo from the camera roll in the Pi admin. iOS should
convert it from HEIC to JPEG on the way. It should upload and display normally.

## 7. Tear down AWS

After uploads work on the Pi:

```sh
aws login
cd ~/code/r-present-website/devops/aws
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_CREDENTIAL_EXPIRATION
eval "$(aws configure export-credentials --format env)"
terraform destroy
```

This removes what Terraform created: the ACM certificate, the CloudFront origin
access control and the bucket's public access block. The `r-present` bucket
itself isn't managed by Terraform. It only holds two empty placeholders under
`assets/`, so delete it by hand if you like.

Then:

- Close the AWS support case.
- Delete `devops/aws/`, and the AWS parts of the README and
  `admin-launch-remaining-steps.md`. Keep the `@aws-sdk/client-s3` package;
  it's what talks to R2.

---

## Open questions / later

- **Cloudflare in front of the site too?** Proxying r-present.com through
  Cloudflare would add caching and analytics, but it complicates GitHub Pages'
  HTTPS. Not worth it at this size.
- **Unused photos stay in R2** after Discard or after a photo is removed from
  an entry. They're cheap. A cleanup script can come later if it ever matters.
- **Rotate the Pi token** if the Pi is ever lost or reimaged: delete it in R2 →
  Manage API tokens, make a new one, and repeat the Pi part of step 5.
- **The dev token expires** after 30 days. Make a new one when you need it.
