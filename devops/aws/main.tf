data "aws_s3_bucket" "images" {
  bucket = var.bucket_name
}

# --- Certificate for images.r-present.com -----------------------------------

resource "aws_acm_certificate" "images" {
  provider          = aws.us_east_1
  domain_name       = var.images_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  validation_records = {
    for o in aws_acm_certificate.images.domain_validation_options : o.domain_name => {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.route53_zone_id == null ? {} : local.validation_records

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.value]
  ttl     = 300
}

# Waits until the validation record is visible in DNS. If DNS isn't in
# Route 53, add the record from the `certificate_validation_record` output
# while this is waiting (see README).
resource "aws_acm_certificate_validation" "images" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.images.arn
}

# --- CloudFront in front of the (private) bucket ------------------------------

resource "aws_cloudfront_origin_access_control" "images" {
  name                              = "${var.bucket_name}-oac"
  description                       = "Lets CloudFront read ${var.bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "images" {
  enabled         = true
  comment         = "R. Present photos (${var.images_domain})"
  aliases         = [var.images_domain]
  price_class     = "PriceClass_100" # North America + Europe; cheapest
  is_ipv6_enabled = true

  origin {
    origin_id                = "s3-${var.bucket_name}"
    domain_name              = data.aws_s3_bucket.images.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.images.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-${var.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.images.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_route53_record" "images" {
  for_each = var.route53_zone_id == null ? toset([]) : toset(["A", "AAAA"])

  zone_id = var.route53_zone_id
  name    = var.images_domain
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.images.domain_name
    zone_id                = aws_cloudfront_distribution.images.hosted_zone_id
    evaluate_target_health = false
  }
}

# --- Bucket policy: only this CloudFront distribution may read --------------
#
# NOTE: a bucket has exactly one policy, and this REPLACES whatever is there.
# Check `aws s3api get-bucket-policy --bucket <name>` first (see README).

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${data.aws_s3_bucket.images.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.images.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "images" {
  bucket = data.aws_s3_bucket.images.id
  policy = data.aws_iam_policy_document.bucket.json

  # Apply after the public-access block so the two never race.
  depends_on = [aws_s3_bucket_public_access_block.images]
}

# Photos are only ever read through CloudFront, so the bucket never needs to be
# public. (The CloudFront-only policy above doesn't count as "public".)
resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = data.aws_s3_bucket.images.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# --- Upload-only user for the Pi -------------------------------------------------

resource "aws_iam_user" "uploader" {
  name = var.uploader_user_name
  tags = {
    purpose = "R. Present admin photo uploads from the Raspberry Pi"
  }
}

data "aws_iam_policy_document" "uploader" {
  statement {
    sid       = "UploadPhotos"
    actions   = ["s3:PutObject"]
    resources = [for p in var.upload_prefixes : "${data.aws_s3_bucket.images.arn}/${p}*"]
  }
}

resource "aws_iam_user_policy" "uploader" {
  name   = "upload-photos"
  user   = aws_iam_user.uploader.name
  policy = data.aws_iam_policy_document.uploader.json
}
