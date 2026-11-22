variable "bucket_name" {
  description = "Existing S3 bucket that stores the site's photos."
  type        = string
}

variable "aws_region" {
  description = "Region the bucket lives in."
  type        = string
  default     = "us-west-2"
}

variable "images_domain" {
  description = "Domain the photos are served from."
  type        = string
  default     = "images.r-present.com"
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone for the domain. Leave null if DNS lives elsewhere; the records to add by hand are then printed as outputs."
  type        = string
  default     = null
}

variable "uploader_user_name" {
  description = "IAM user the Pi's admin backend uploads as."
  type        = string
  default     = "r-present-admin-uploader"
}

variable "upload_prefixes" {
  description = "Folders in the bucket the uploader may write to."
  type        = list(string)
  default     = ["products/", "projects/", "markets/", "dev/"]
}
