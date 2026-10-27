const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The time zone of the times on pages: `LOG_TIMEZONE`, which `index.ts` copies to `TZ` at startup, else the host's. Read on every
 * call (and the formatter cached per zone) so that it is always the zone the process currently runs in.
 */
function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    });
    formatters.set(key, f);
  }
  return f;
}

function partsOf(d: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(process.env.TZ || undefined).formatToParts(d)) parts[p.type] = p.value;
  return parts;
}

/**
 * `ddd d MMM H:mm zone` in the site's time zone, e.g. "Wed 5 Mar 4:07 UTC" or "Wed 5 Mar 15:07 GMT+11". The year is added when
 * it is not the current year (`now`, the year in that same zone): "Wed 5 Mar 2025 15:07 GMT+11".
 */
export function formatTimestamp(d: Date, now: Date = new Date()): string {
  const t = partsOf(d);
  const year = t.year !== partsOf(now).year ? ` ${t.year}` : '';
  return `${t.weekday} ${t.day} ${t.month}${year} ${Number(t.hour)}:${t.minute} ${t.timeZoneName}`;
}

export interface Age {
  text: string;
  /** Legacy rule: the age is only highlighted when the time is in the past and less than a day ago. */
  recent: boolean;
}

/** Legacy `GetAgeStr(withSec: false)`: "N d N hr N min ago" (days and hours only when non-zero). */
export function formatAge(time: Date, now: Date): Age {
  const diffMs = now.getTime() - time.getTime();
  const ahead = diffMs < 0;
  const total = Math.floor(Math.abs(diffMs) / 60_000); // whole minutes
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  let text = '';
  if (days > 0) text += `${days} d `;
  if (days > 0 || hours > 0) text += `${hours} hr `;
  text += `${minutes} min ${ahead ? 'ahead' : 'ago'}`;
  return { text, recent: !ahead && diffMs < 86_400_000 };
}
