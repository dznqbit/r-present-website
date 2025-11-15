import { defineCollection, z } from 'astro:content';

const products = defineCollection({
  type: 'data',
  schema: z.object({
    sku: z.string(),
    createdAt: z.coerce.date(),
    name: z.string(),
    category: z.string(),
    description: z.string(),
    available: z.boolean(),
    images: z.array(z.string().url()),
  }),
});

const markets = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    date: z.coerce.date(),
    location: z.string(),
    address: z.string().optional(),
    url: z.string().url().optional(),
  }),
});

export const collections = {
  products,
  markets,
};
