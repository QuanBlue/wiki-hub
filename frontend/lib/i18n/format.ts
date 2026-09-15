import type { Locale } from "./core";

const INTL_LOCALES: Record<Locale, string> = { en: "en-US", vi: "vi-VN" };

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Sep 15, 2026" / "15 thg 9, 2026" */
export function formatDate(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(toDate(value));
}

/** "Sep 15, 2026, 3:42 PM" / "15 thg 9, 2026, 15:42" */
export function formatDateTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(toDate(value));
}

/** "15:42" — 24-hour clock, for "at {time}" compositions. */
export function formatTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(toDate(value));
}

/** "Sep 15" / "15 thg 9" — compact, for dense lists. */
export function formatDateShort(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    month: "short",
    day: "numeric",
  }).format(toDate(value));
}

/** "Sep 15, 3:42 PM" / "15 thg 9, 15:42" — same-day elision, dense lists. */
export function formatDateOrTime(
  value: string | Date,
  locale: Locale,
): string {
  const date = toDate(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(
    INTL_LOCALES[locale],
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  ).format(date);
}
