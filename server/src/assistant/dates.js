/*
 * One place that turns what a traveller typed into calendar dates.
 *
 * Everything is a plain YYYY-MM-DD string in the BUSINESS timezone (default
 * Asia/Kolkata, override with BUSINESS_TZ). "Today" is therefore the same day for
 * the traveller, the API server and the database, whatever the server clock says.
 * The language model never sees or produces dates: tools receive only what this
 * module validated.
 *
 * Supported: 2026-11-21, 21/11/2026, "21 november 2026", "21st Nov", "november 21",
 * today, tomorrow, this weekend, a weekday name.
 *
 * Weekend policy: "this weekend" is Saturday+Sunday. On Saturday that is today and
 * tomorrow; on Sunday only today is left, so it is that single day (never a past
 * Saturday). Tools that need ONE day ask which of the two the traveller wants.
 *
 * Day+month with no year means the next time that date comes round ("29 october"
 * said in November is next year). A year that is given is never second-guessed:
 * a past date stays past so the assistant can say so instead of quietly moving it.
 */

const DEFAULT_TZ = 'Asia/Kolkata';
let tzChecked;

/** The configured business timezone, falling back to IST if BUSINESS_TZ is not a real zone. */
export function businessTimeZone() {
  const wanted = process.env.BUSINESS_TZ || DEFAULT_TZ;
  if (tzChecked?.wanted !== wanted) {
    let ok = true;
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: wanted });
    } catch {
      ok = false;
    }
    tzChecked = { wanted, tz: ok ? wanted : DEFAULT_TZ };
  }
  return tzChecked.tz;
}

/** Calendar date (YYYY-MM-DD) of an instant in the business timezone. */
export function istDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
export const MONTH_SRC =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_SRC}\\b(?:[,\\s]+(\\d{4}))?`, 'i');
// "may 2 people" is a group size, not a date.
const MONTH_DAY = new RegExp(
  `\\b${MONTH_SRC}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?![\\s,]*(?:people|persons?|pax|seats?|adults?|travell?ers?|tickets?))(?:[,\\s]+(\\d{4}))?`,
  'i'
);
const NUMERIC_DMY = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/; // India: day first
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`, 'i');

/** A real calendar date as YYYY-MM-DD, or null (31 February is not a date). */
export function buildDate(year, month, day) {
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Parse an explicit date in the text.
 * @returns {{ iso: string|null, text: string }|null} null when the text has no explicit date;
 *          iso is null when it has one that does not exist.
 */
function explicitDate(text, today) {
  const thisYear = Number(today.slice(0, 4));

  const iso = text.match(ISO_DATE_RE);
  if (iso) return { text: iso[0], iso: buildDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) };

  const dmy = text.match(NUMERIC_DMY);
  if (dmy) {
    return { text: dmy[0], iso: buildDate(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) };
  }

  const named = text.match(DAY_MONTH);
  const named2 = named ? null : text.match(MONTH_DAY);
  if (named || named2) {
    const [day, monthWord, yearText] = named
      ? [Number(named[1]), named[2], named[3]]
      : [Number(named2[2]), named2[1], named2[3]];
    const month = MONTHS[monthWord.slice(0, 3).toLowerCase()];
    const matched = (named ?? named2)[0].trim();
    if (yearText) return { text: matched, iso: buildDate(Number(yearText), month, day) };
    const upcoming = buildDate(thisYear, month, day);
    if (!upcoming) return { text: matched, iso: null };
    return { text: matched, iso: upcoming >= today ? upcoming : buildDate(thisYear + 1, month, day) };
  }
  return null;
}

/**
 * The date(s) a traveller means as { from, to } (business-timezone calendar days),
 * or null when there is none or it is not a real date. May be in the past: ask
 * dateProblem() to find out, so callers can explain instead of guessing.
 */
export function resolveDateRange(text, now = new Date()) {
  const today = istDate(now);
  const range = (iso) => (iso ? { from: iso, to: iso } : null);

  const explicit = explicitDate(text, today);
  if (explicit) return range(explicit.iso);

  if (/\btoday\b/i.test(text)) return range(today);
  if (/\btomorrow\b/i.test(text)) return range(addDays(today, 1));
  if (/\b(this|coming) weekend\b/i.test(text)) {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    if (dow === 0) return { from: today, to: today };
    const saturday = addDays(today, (6 - dow + 7) % 7);
    return { from: saturday, to: addDays(saturday, 1) };
  }

  const weekday = text.match(WEEKDAY_RE);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1].toLowerCase());
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    return range(addDays(today, (target - dow + 7) % 7));
  }
  return null;
}

/**
 * Something wrong with the date the traveller gave, in words fit to show them.
 * @returns {{ kind: 'invalid'|'past', input: string, message: string }|null}
 */
export function dateProblem(text, now = new Date()) {
  const today = istDate(now);
  const explicit = explicitDate(text, today);
  if (explicit && !explicit.iso) {
    return { kind: 'invalid', input: explicit.text, message: `"${explicit.text}" is not a real calendar date.` };
  }
  const range = resolveDateRange(text, now);
  if (range && range.to < today) {
    return { kind: 'past', input: range.from, message: `${range.from} has already passed.` };
  }
  return null;
}
