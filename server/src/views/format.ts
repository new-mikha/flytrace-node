const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Legacy format `ddd d MMM H:mm UTC`, e.g. "Wed 5 Mar 4:07 UTC". */
export function formatTimestamp(d: Date): string {
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCHours()}:${minutes} UTC`;
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
