import { getCollection, type CollectionEntry } from "astro:content";

export type Product = CollectionEntry<"products">;

/**
 * Products shown in listings (the shop, category pages, a project's featured
 * pieces). Unpublished products still get their own page, reachable only by
 * a direct link.
 */
export async function getPublishedProducts(): Promise<Product[]> {
  return getCollection("products", (p) => p.data.published);
}
