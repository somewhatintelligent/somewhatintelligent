// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { formatDetailDate, formatListDate, formatQuotedDate, formatShortDate } from "../dates";

// Fixed "now" so the today/this-year/older branches in formatListDate are
// deterministic. 2024-06-15 is a Saturday.
const NOW = "2024-06-15T12:00:00Z";

// The host-locale formatters pass `undefined` locale through to Intl, so
// their rendering varies by machine (en-CA ICU says "12:00 p.m."). What the
// functions own is WHICH parts render (today → time-only, this year →
// month+day, older → +year) — assert that by rendering the same parts with
// the same options, in whatever locale the host uses.
const timeOnly = (d: string) =>
  new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const monthDay = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const monthDayYear = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatListDate", () => {
  it("renders a bare time for a date that is today", () => {
    expect(formatListDate(NOW)).toBe(timeOnly(NOW));
  });

  it("renders month + day for a date earlier this year", () => {
    expect(formatListDate("2024-01-05T00:00:00Z")).toBe(monthDay("2024-01-05T00:00:00Z"));
  });

  it("renders month + day + year for a date in a previous year", () => {
    expect(formatListDate("2020-04-15T00:00:00Z")).toBe(monthDayYear("2020-04-15T00:00:00Z"));
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatListDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDetailDate", () => {
  it("renders weekday, month, day, and time", () => {
    expect(formatDetailDate(NOW)).toBe(
      new Date(NOW).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatDetailDate("garbage")).toBe("garbage");
  });
});

describe("formatShortDate", () => {
  it("renders time only", () => {
    expect(formatShortDate(NOW)).toBe(timeOnly(NOW));
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatShortDate("garbage")).toBe("garbage");
  });
});

describe("formatQuotedDate", () => {
  it("renders the full en-US quoted-reply format regardless of default locale", () => {
    expect(formatQuotedDate(NOW)).toBe("Sat, Jun 15, 2024, 12:00 PM");
  });

  it("returns an empty string for undefined input", () => {
    expect(formatQuotedDate(undefined)).toBe("");
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatQuotedDate("garbage")).toBe("garbage");
  });
});
