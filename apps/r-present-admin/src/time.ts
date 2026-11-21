/** "just now", "4 min ago", "2 hr ago", or a date for anything older than a day. */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
