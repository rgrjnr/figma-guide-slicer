import { DateTime } from "luxon";

/**
 * Scheduling is the one place in this robot where being wrong is expensive: a
 * timezone slip sends a campaign at 3am. So the wall-clock time and the zone
 * are kept separate all the way to the form, and never passed around as a
 * bare Date, which would silently carry the runner machine's local zone.
 */

export class ScheduleError extends Error {}

/**
 * @param {string} localTime  "2026-09-01 09:30" or ISO — read as wall-clock time
 *                            *in `zone`*, never in the runner's local zone.
 * @param {string} zone       IANA name, e.g. "America/Sao_Paulo".
 */
export function resolveSendTime(localTime, zone, now = DateTime.utc()) {
  if (!zone || !DateTime.local().setZone(zone).isValid) {
    throw new ScheduleError(`"${zone}" is not an IANA time zone (e.g. America/Sao_Paulo).`);
  }

  const normalized = String(localTime).trim().replace(" ", "T");
  const dt = DateTime.fromISO(normalized, { zone, setZone: true });
  if (!dt.isValid) {
    throw new ScheduleError(`Could not read "${localTime}" as a date and time. ${dt.invalidExplanation ?? ""}`.trim());
  }

  // A wall-clock time inside a spring-forward gap does not exist. Luxon quietly
  // shifts it forward an hour; say so rather than scheduling an hour off.
  const roundTrip = dt.toFormat("yyyy-LL-dd'T'HH:mm");
  const asked = DateTime.fromISO(normalized).toFormat("yyyy-LL-dd'T'HH:mm");
  const skippedByDst = roundTrip !== asked;

  if (dt.toUTC() <= now) {
    throw new ScheduleError(
      `${dt.toFormat("yyyy-LL-dd HH:mm")} in ${zone} is in the past (it is now ${now.setZone(zone).toFormat("yyyy-LL-dd HH:mm")} there).`
    );
  }

  return {
    /** What to type into the form. */
    date: dt.toFormat("yyyy-LL-dd"),
    time: dt.toFormat("HH:mm"),
    zone,
    /** For logging and for confirming what the dashboard ends up displaying. */
    iso: dt.toISO(),
    utc: dt.toUTC().toISO(),
    offset: dt.toFormat("ZZ"),
    /** True when the requested wall-clock time does not exist on that date. */
    skippedByDst,
    describe() {
      return `${dt.toFormat("ccc d LLL yyyy, HH:mm")} ${zone} (${dt.toFormat("ZZ")}) = ${dt.toUTC().toFormat("yyyy-LL-dd HH:mm")}Z`;
    },
  };
}

/** Same instant, seen from another zone. For sanity-checking a schedule. */
export function inZone(sendTime, zone) {
  return DateTime.fromISO(sendTime.iso).setZone(zone).toFormat("yyyy-LL-dd HH:mm");
}
