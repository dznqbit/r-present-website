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

export const collections = {
  products,
  markets,
  projects,
};
