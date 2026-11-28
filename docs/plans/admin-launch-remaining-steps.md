# Admin launch: remaining steps

_Last updated 2026-11-22._

> **2026-11-27: steps 1–5 are replaced by
> [cloudflare-migration.md](cloudflare-migration.md).** AWS never verified the
> account for CloudFront, so photos move to Cloudflare R2 instead. Step 6 is
> done. Step 7 (iPhone) moved into the new plan. The open questions about
> `deploy.sh`, the publish author and unused photos still apply.

The admin is live on the Pi at http://192.168.0.16:8080/. It's on `main` at
`e94cb4d` (PR #7). Editing, Preview, Publish and Discard work.

**Photo uploads don't work on the Pi yet.** S3 isn't connected, so photos land
on the Pi with a `localhost` address that browsers can't load. Publish refuses
entries that use those photos, so nothing broken reaches the live site. Until
step 4 is done, don't add photos from the Pi.

## Status

| # | Step | Who | Blocked on |
|---|------|-----|------------|
| 1 | AWS verifies the account for CloudFront | Q (support case) | AWS Support |
| 2 | Finish `terraform apply` | Q | 1 |
| 3 | Add the `images` CNAME at Namecheap | Q | 2 |
| 4 | Put the uploader key and S3 settings on the Pi | Claude | 2 |
| 5 | Test uploads end to end (laptop, then Pi) | Claude + Q | 3, 4 |
| 6 | Let deploy keys bypass the `main` ruleset | Q | none |
| 7 | Upload a test photo from an iPhone (HEIC) | Q | 5 |

Step 6 doesn't depend on anything else. Until it's done, **Publish from the Pi
fails** with "only accepts pull requests".

---

## 1. Get the account verified for CloudFront

`terraform apply` stopped at:

> AccessDenied: Your account must be verified before you can add new CloudFront resources.

Open a case at https://console.aws.amazon.com/support/home#/ and fill it in
like this:

- **Type:** Account and billing (free, no support plan needed)
- **Subject:** Account verification for CloudFront
- **Body:** paste the error above, and add: "Small business site. I want one
  CloudFront distribution to serve product photos from my S3 bucket at
  images.r-present.com."

Replies usually take a few hours to a day.

## 2. Finish `terraform apply`

Some of the resources already exist:

- the ACM cert (validated, ISSUED)
- the CloudFront origin access control
- the bucket's public access block

Still to create:

- the CloudFront distribution
- the bucket policy
- the IAM user `r-present-admin-uploader` and its policy (the tag bug that
  blocked the user is fixed)

```sh
aws login
cd ~/code/r-present-website/devops/aws
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_CREDENTIAL_EXPIRATION
eval "$(aws configure export-credentials --format env)"
terraform apply
```

CloudFront takes 5–15 minutes. Then:

```sh
terraform output cloudfront_domain   # e.g. d1234abcd.cloudfront.net
```

If you get `ExpiredToken`, the shell is still holding stale exported
credentials. Re-run the `unset` and `eval` lines.

## 3. DNS at Namecheap

Under r-present.com → Advanced DNS, add:

| Type | Host | Value |
|------|------|-------|
| CNAME | `images` | the `cloudfront_domain` output from step 2 |

Keep the existing `_ab0cf…images` CNAME. ACM needs it to renew the
certificate.

To check it:

```sh
dig +short images.r-present.com
```

It should print the CloudFront domain.

## 4. Uploader key and S3 settings on the Pi

The access key goes straight from AWS into a root-only file on the Pi, so it
never shows up in a terminal, in chat, or in Terraform state:

```sh
aws iam create-access-key --user-name r-present-admin-uploader \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text |
  ssh 192.168.0.16 'read -r id secret
    sudo install -m 600 -o root -g root /dev/null /etc/r-present-admin.env
    printf "S3_BUCKET=r-present\nS3_REGION=us-west-2\nIMAGES_BASE_URL=https://images.r-present.com\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n" "$id" "$secret" |
      sudo tee /etc/r-present-admin.env >/dev/null
    sudo systemctl restart r-present-admin-backend
    sudo grep -c = /etc/r-present-admin.env'
```

The last line should print `5`.

The systemd unit already loads this file (`EnvironmentFile=-/etc/r-present-admin.env`),
and the up-to-date unit is installed on the Pi.

## 5. Test uploads end to end

**On the laptop first.** These uploads go under `dev/` in the bucket, so they
never mix with real photos. Use your own AWS login, not the uploader key.

```sh
cd apps/r-present-admin-backend
eval "$(aws configure export-credentials --format env)"
S3_BUCKET=r-present S3_REGION=us-west-2 S3_PREFIX=dev/ \
  IMAGES_BASE_URL=https://images.r-present.com npm run dev
```

Upload a photo in the local admin, then check both addresses:

- `https://images.r-present.com/dev/products/<hash>.jpg` should return **200**.
- `https://r-present.s3.us-west-2.amazonaws.com/dev/products/<hash>.jpg`
  should return **403**, because the bucket only serves through CloudFront.

**Then on the Pi.** Add a photo to an entry, save it, and Preview it. Don't
Publish a test entry; use **Discard…** afterwards.

## 6. Let deploy keys bypass the `main` ruleset

`main` only accepts pull requests. Publish from the Pi pushes directly using
the Pi's deploy key, so the ruleset has to let deploy keys through:

GitHub → repo Settings → Rules → Rulesets → the `main` ruleset →
**Bypass list** → Add bypass → **Deploy keys** → Always allow.

To test it, make a small real edit in the admin and Publish it. The Pages
deploy should run, and the change should appear on r-present.com within a few
minutes.

## 7. iPhone photos

The upload field only accepts JPEG, PNG and WebP, which makes iOS convert HEIC
to JPEG before uploading. To confirm, add a photo from the iPhone's camera
roll in the Pi admin. It should upload and display normally.

---

## Open questions / later

- **Existing `assets/` folder in the bucket.** It holds 2 empty placeholder
  objects. New uploads go to `products/`, `projects/` and `markets/` at the top
  level. Delete `assets/` or leave it; nothing uses it.
- **`deploy.sh` doesn't install the systemd unit.** When
  `devops/pi/r-present-admin-backend.service` changes, install it by hand:
  `sudo install -m 644 devops/pi/r-present-admin-backend.service /etc/systemd/system/`,
  then `sudo systemctl daemon-reload` and a restart. It could be automated.
- **Publish author.** Commits use `R. Present Admin <admin@r-present.com>`,
  which is a placeholder. To change it, edit `PUBLISH_AUTHOR_*` in the unit.
- **Unused photos stay in S3** after Discard or after a photo is removed from
  an entry. They're cheap and harmless. A cleanup script can come later if it
  ever matters.
- **Rotate the uploader key** if the Pi is ever lost or reimaged: run
  `aws iam delete-access-key`, then repeat step 4.
