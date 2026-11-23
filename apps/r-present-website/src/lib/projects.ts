import { getCollection, type CollectionEntry } from "astro:content";

export type Project = CollectionEntry<"projects">;

/** All projects in display order: lowest `index` first, ties by name. */
export async function getProjectsByIndex(): Promise<Project[]> {
  return (await getCollection("projects")).sort(
    (a, b) =>
      a.data.index - b.data.index || a.data.name.localeCompare(b.data.name),
  );
}
