/** Ages, in the two lengths the design uses: `2d` on a card, `2 days ago` in a sheet. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** `now` · `4m` · `5h` · `2d` · `2w` · `4mo` · `1y` */
export const shortAge = (at: number, now: number = Date.now()): string => {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / WEEK)}w`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)}mo`;
  return `${Math.floor(elapsed / YEAR)}y`;
};

/** `2 days ago` · `1 week ago` · `3 weeks ago` */
export const longAge = (at: number, now: number = Date.now()): string => {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < WEEK) return relative.format(-Math.floor(elapsed / DAY), "day");
  if (elapsed < MONTH) return relative.format(-Math.floor(elapsed / WEEK), "week");
  if (elapsed < YEAR) return relative.format(-Math.floor(elapsed / MONTH), "month");
  return relative.format(-Math.floor(elapsed / YEAR), "year");
};

export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;
