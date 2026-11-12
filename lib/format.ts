// Formatting shared by the server (reasons, emails) and the browser (pages, widgets).

const moneyFormats = new Map<string, Intl.NumberFormat>();

/**
 * Money with Intl.NumberFormat: "$1,200.00" on screen, or "USD 1,200.00" with `code` (emails and
 * reasons, where the currency must be unambiguous). An unknown currency code falls back to "XYZ 12.00".
 */
export function formatMoney(value: number, currency = 'USD', opts: { code?: boolean; whole?: boolean } = {}) {
  const key = `${currency}|${opts.code ? 'c' : 's'}|${opts.whole ? 'w' : 'f'}`;
  let f = moneyFormats.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        currencyDisplay: opts.code ? 'code' : 'symbol',
        ...(opts.whole && { maximumFractionDigits: 0 }),
      });
    } catch {
      return `${currency} ${value.toFixed(opts.whole ? 0 : 2)}`;
    }
    moneyFormats.set(key, f);
  }
  // Intl puts a no-break space after the code; a plain space reads the same and copies better.
  return f.format(value).replace(/ /g, ' ');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** From days overdue (negative = not due yet): "due today", "due in 3 days", "12 days late". */
export function relativeDue(daysOverdue: number) {
  if (daysOverdue === 0) return 'due today';
  return daysOverdue < 0 ? `due in ${plural(-daysOverdue, 'day')}` : `${plural(daysOverdue, 'day')} late`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "3 days ago". */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Nov 19" for a YYYY-MM-DD (or ISO) date. */
export const formatDay = (iso: string) => shortDate.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
