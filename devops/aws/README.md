# AWS: photo hosting

Photos the admin uploads live in an existing S3 bucket and are served from
**https://images.r-present.com** through CloudFront. This Terraform sets up:

| Resource | Why |
| --- | --- |
| ACM certificate (us-east-1) | HTTPS for `images.r-present.com` (CloudFront requires us-east-1) |
| CloudFront distribution + origin access control | Fast, cached, HTTPS delivery. The bucket itself stays private |
| Bucket policy | Lets only that CloudFront distribution read the bucket |
| Block public access | The bucket itself is never public; CloudFront is the only way in |
| IAM user `r-present-admin-uploader` | What the Pi uploads as: `s3:PutObject` into `products/`, `projects/`, `markets/`, `dev/`. Nothing else |
| Route 53 records (optional) | Only if `route53_zone_id` is set |

The bucket itself is **not** created or modified beyond its policy.

## One-time setup

1. **Install Terraform** with `brew install terraform`, and get AWS credentials with permission to
   manage ACM, CloudFront, IAM and the bucket's policy (e.g. `export AWS_PROFILE=...`).
   Logged in with `aws login`? Terraform may not read that session directly. Export it first:
   `eval "$(aws configure export-credentials --format env)"`.

2. **Check the bucket's current policy.** Terraform *replaces* it.

   ```sh
   aws s3api get-bucket-policy --bucket <bucket>
   ```

   If it prints something, it has statements we'd drop. Merge them into `data "aws_iam_policy_document" "bucket"`
   in `main.tf` first. "NoSuchBucketPolicy" means there's nothing to lose.

3. **Configure:**

   ```sh
   cd devops/aws
   cp terraform.tfvars.example terraform.tfvars   # set bucket_name, aws_region, maybe route53_zone_id
   terraform init
   ```

4. **Create the certificate first** and get its DNS validation record:

   ```sh
   terraform apply -target=aws_acm_certificate.images
   terraform output certificate_validation_record
   ```

   If DNS is **not** in Route 53, add that CNAME at your DNS provider now.

5. **Apply everything.** It waits for the certificate to validate, then creates CloudFront (~5–15 min):

   ```sh
   terraform apply
   ```

6. If DNS is **not** in Route 53, add a CNAME: `images.r-present.com → <terraform output cloudfront_domain>`.

7. **Create the uploader's access key** by hand. It's kept out of Terraform state on purpose:

   ```sh
   aws iam create-access-key --user-name r-present-admin-uploader
   ```

## Pointing the admin at S3

On the **Pi**, create `/etc/r-present-admin.env` (`sudo install -m 600 /dev/null /etc/r-present-admin.env`,
then edit it). The systemd unit loads it:

```sh
S3_BUCKET=<bucket>
S3_REGION=us-west-2
IMAGES_BASE_URL=https://images.r-present.com
AWS_ACCESS_KEY_ID=<from step 7>
AWS_SECRET_ACCESS_KEY=<from step 7>
```

Then run `sudo systemctl restart r-present-admin-backend`.

On a **laptop**, use the same variables plus `S3_PREFIX=dev/`, so test uploads stay in `dev/`
and never mix with real photos. Without `S3_BUCKET`, the backend saves photos to `.uploads/`
locally instead. Publish refuses to push entries that point at those local photos.

## Checking it works

```sh
curl -I https://images.r-present.com/products/<some-uploaded-file>.jpg   # 200, x-cache: Hit/Miss from cloudfront
curl -I https://<bucket>.s3.<region>.amazonaws.com/products/<same>.jpg   # 403: bucket is private
```
