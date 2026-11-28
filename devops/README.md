# devops

- [`pi/`](pi/): the admin stack on the Raspberry Pi (192.168.0.15, `ssh pi-hole`). That covers nginx, systemd and the deploy script.
- [`aws/`](aws/): Terraform for photo hosting (S3 + CloudFront at images.r-present.com, plus the Pi's upload-only IAM user).

The public website deploys separately, through GitHub Actions to GitHub Pages
(`.github/workflows/deploy.yml`).
