import { getCollection, type CollectionEntry } from "astro:content";

export type Market = CollectionEntry<"markets">;

/**
 * Market dates are calendar days, stored as midnight UTC. A market counts as
 * upcoming through the end of its day, so compare against the start of today
 * (UTC) rather than "now".
 *
 * The site is static, so "today" means the day the site was built.
 */
export function isUpcoming(date: Date): boolean {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  return date >= startOfToday;
}

const byDate = (a: Market, b: Market) =>
  a.data.date.getTime() - b.data.date.getTime();

/** Upcoming markets, soonest first. Pass `limit` for just the next few. */
export async function getUpcomingMarkets(limit?: number): Promise<Market[]> {
  const markets = (await getCollection("markets"))
    .filter((m) => isUpcoming(m.data.date))
    .sort(byDate);
  return limit === undefined ? markets : markets.slice(0, limit);
}

/** Past markets, most recent first. Pass `limit` for just the last few. */
export async function getPastMarkets(limit?: number): Promise<Market[]> {
  const markets = (await getCollection("markets"))
    .filter((m) => !isUpcoming(m.data.date))
    .sort((a, b) => byDate(b, a));
  return limit === undefined ? markets : markets.slice(0, limit);
}

/** "Sat, Jan 16". Uses UTC so the stored calendar day never shifts. */
export const formatShortMarketDate = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
