import { defineCollection, reference, z } from "astro:content";

const products = defineCollection({
  type: "data",
  schema: z.object({
    sku: z.string(),
    createdAt: z.coerce.date(),
    name: z.string(),
    category: z.string(),
    description: z.string(),
    available: z.boolean(),
    // Off hides the product from the shop and category pages (its own page
    // still exists). Products saved before this field existed count as on.
    published: z.boolean().default(true),
    images: z.array(z.string().url()),
    price: z.number().positive().optional(),
    buyLinkUrl: z.string().optional(),
  }),
});

const markets = defineCollection({
  type: "data",
  schema: z.object({
    name: z.string(),
    date: z.coerce.date(),
    timeDescription: z.string(),
    location: z.string(),
    address: z.string().optional(),
    url: z.string().url().optional(),
  }),
});

const projects = defineCollection({
  type: "data",
  schema: z.object({
    name: z.string(),
    // Display order on the home page: lower numbers come first.
    index: z.number().int(),
    date: z.coerce.date(),
    description: z.string(),
    images: z.array(
      z.object({
        url: z.string().url(),
        description: z.string(),
      }),
    ),
    location: z.string().optional(),
    products: z.array(reference("products")).optional(),
  }),
});

// Fixed site pages (e.g. about.json). The admin edits them but can't add or
// delete them, since each one backs a hand-built page.
const pages = defineCollection({
  type: "data",
  schema: z.object({
    name: z.string(),
    // Markdown.
    body: z.string(),
  }),
});

export const collections = {
  products,
  markets,
  projects,
  pages,
};
