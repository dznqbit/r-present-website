terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State is kept locally (gitignored). It holds no secrets: the uploader's
  # access key is created by hand, not by Terraform.
}

provider "aws" {
  region = var.aws_region
}

# CloudFront only accepts ACM certificates from us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
