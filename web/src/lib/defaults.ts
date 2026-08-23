/**
 * Defaults chosen to match how this work actually arrives: a request email with
 * a design, a title, a spreadsheet of addresses, and a date. Anything that would
 * be typed the same way every time is filled in already.
 */

/** Sends go out from Brazil, so that is the zone the times are meant in. */
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/** The naming convention already in use for campaigns and segments. */
export function stamp(date = new Date(), zone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** Tomorrow in the sending zone, as an <input type="date"> value. */
export function defaultSendDate(now = new Date(), zone = DEFAULT_TIME_ZONE): string {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(tomorrow);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The usual slot. */
export const DEFAULT_SEND_TIME = "09:30";

/**
 * Zones offered in the picker. The ones actually used come first; the rest of
 * the IANA list follows so an unusual send is still possible without typing an
 * identifier from memory.
 */
export function timeZones(): { common: string[]; all: string[] } {
  const common = [
    "America/Sao_Paulo",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "America/Mexico_City",
    "America/Bogota",
    "America/Argentina/Buenos_Aires",
    "Europe/London",
    "Europe/Madrid",
    "Europe/Lisbon",
    "UTC",
  ];
  // Intl.supportedValuesOf is newer than the TS lib target; guarded either way.
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const supported = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
  return { common, all: supported.filter(z => !common.includes(z)) };
}

/** "2026-09-01" + "09:30" as the flows want it. */
export function combineSendAt(date: string, time: string): string {
  return `${date} ${time}`.trim();
}
