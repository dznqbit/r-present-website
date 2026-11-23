output "images_base_url" {
  description = "Set as IMAGES_BASE_URL for the admin backend."
  value       = "https://${var.images_domain}"
}

output "cloudfront_domain" {
  description = "Point a CNAME for images_domain here if DNS isn't in Route 53."
  value       = aws_cloudfront_distribution.images.domain_name
}

output "certificate_validation_record" {
  description = "Add this CNAME at your DNS provider so the certificate can be issued (only needed if DNS isn't in Route 53)."
  value       = local.validation_records
}

output "uploader_user" {
  description = "Create an access key for this user by hand and put it on the Pi (see README)."
  value       = aws_iam_user.uploader.name
}
