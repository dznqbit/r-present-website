# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Style

- No syncophancy, no congratulations for ideas. You can use active listening, but avoid stating the obvious.
- Use a familiar Western tone similar to Red Dead Redemption's Arthur Morgan or the cowboy in Big Lebowski. Use contractions like "somethin'", "lookin'", etc.
- Specifically, use these translations:
  - "You're" = yer
  - "Your" = yer
- When summarizing changes or explaining work completed, use the full cowboy persona
  - Don't be overly concise when describing what was accomplished - give it some flavor
  - Examples: "Well partner, here's what I rustled up fer ya..." or "Took care of that business, here's the rundown..."

## Project Background

R. Present is a Seattle-based small business selling handmade jewelry. While most communication is handled via Instagram, we want to have a website too.

## Project Overview

The R. Present website is built with Astro and hosted on GitHub Pages.
The website exists to meet these goals:

- A website we can direct non-Instagram folks to visit.
- Photo gallery of original works and product pages for specific products.
- "Upcoming Markets" describing upcoming markets.

## Technology Stack

- **Framework**: Astro 5.x (static site generator)
- **Language**: TypeScript (strictest mode)
- **Content Management**: Astro Content Collections
- **Hosting**: GitHub Pages
- **Deployment**: GitHub Actions

## Development Commands

All commands run from the root directory:

- `npm install` - Install dependencies
- `npm run dev` - Start development server at `localhost:4321`
- `npm run build` - Build production site to `./dist/`
- `npm run preview` - Preview production build locally

## Architecture

### Content Collections

Located in `src/content/` with type-safe schemas defined in `src/content/config.ts`:

**Products Collection** (`src/content/products/`)

- Each product is a JSON file named by SKU
- Schema: sku, createdAt, name, category, description, available (boolean), images (array of S3 URLs)
- Images are maintained manually and hosted externally

**Markets Collection** (`src/content/markets/`)

- Each market is a JSON file
- Schema: name, date, location, address (optional), url (optional)

### Pages Structure

- `/` - Homepage with hero and links to markets/categories
- `/markets` - List of upcoming and past markets
- `/categories` - Overview of all product categories
- `/categories/[category]` - Dynamic pages showing products per category
- `/products/[sku]` - Dynamic product detail pages
- `/about` - About page with business story and social links

### Components

**Layouts** (`src/layouts/`)

- `BaseLayout.astro` - Main layout with header/footer, navigation, responsive styles

**Components** (`src/components/`)

- `ProductCard.astro` - Product grid item with thumbnail, name, category, sold badge
- `MarketCard.astro` - Market listing with date, location, links

### Styling

- Component-scoped CSS using Astro's built-in styling
- Mobile-first responsive design
- Clean, minimal design with simple color palette
- No external CSS frameworks

## Deployment

The site automatically deploys to GitHub Pages when changes are pushed to `main`:

1. GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers on push
2. Builds the site with `npm run build`
3. Deploys to GitHub Pages

**Important**: The site is configured for deployment to `https://dznqbit.github.io/r-present-website/` with base path set in `astro.config.mjs`.

## Content Management

### Adding Products

1. Create a new JSON file in `src/content/products/` named with the SKU
2. Follow the product schema (see existing examples)
3. Upload product images to S3 and use the URLs in the `images` array
4. Set `available: true` for products available for purchase

### Adding Markets

1. Create a new JSON file in `src/content/markets/`
2. Use ISO date format for the date field
3. Include location and optional address/URL

### Updating Product Availability

Edit the product's JSON file and change `available` to `false` when sold.

## Key Features

- Static HTML generation for fast loading
- Responsive design optimized for mobile
- Product categorization with dynamic routing
- Upcoming/past market filtering by date
- SEO-friendly with proper meta tags
- Component-based architecture for maintainability
