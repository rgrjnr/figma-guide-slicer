// Plain node:test — no build step, run with `node --test braze/`.
import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { resolveSendTime, inZone, ScheduleError } from "./schedule.mjs";

const now = DateTime.fromISO("2026-08-23T12:00:00Z", { zone: "utc" });

test("reads the time as wall-clock in the target zone, not the runner's", () => {
  const s = resolveSendTime("2026-09-01 09:30", "America/Sao_Paulo", now);
  assert.equal(s.date, "2026-09-01");
  assert.equal(s.time, "09:30");
  assert.equal(s.utc, "2026-09-01T12:30:00.000Z"); // BRT is UTC-3
});

test("the same wall-clock time in a different zone is a different instant", () => {
  const sp = resolveSendTime("2026-09-01 09:30", "America/Sao_Paulo", now);
  const ny = resolveSendTime("2026-09-01 09:30", "America/New_York", now);
  assert.notEqual(sp.utc, ny.utc);
  assert.equal(inZone(sp, "America/New_York"), "2026-09-01 08:30");
});

test("respects daylight saving on the target date", () => {
  // London is BST (UTC+1) in September and GMT in December.
  assert.equal(resolveSendTime("2026-09-01 09:00", "Europe/London", now).utc, "2026-09-01T08:00:00.000Z");
  assert.equal(resolveSendTime("2026-12-01 09:00", "Europe/London", now).utc, "2026-12-01T09:00:00.000Z");
});

test("flags a wall-clock time that does not exist because of spring forward", () => {
  // US clocks jump 02:00 -> 03:00 on 2027-03-14.
  const s = resolveSendTime("2027-03-14 02:30", "America/New_York", now);
  assert.equal(s.skippedByDst, true);
});

test("does not flag an ordinary time", () => {
  assert.equal(resolveSendTime("2026-09-01 09:30", "America/New_York", now).skippedByDst, false);
});

test("refuses a time in the past", () => {
  assert.throws(() => resolveSendTime("2020-01-01 09:00", "UTC", now), ScheduleError);
});

test("refuses a zone that is not IANA", () => {
  assert.throws(() => resolveSendTime("2026-09-01 09:00", "BRT", now), ScheduleError);
  assert.throws(() => resolveSendTime("2026-09-01 09:00", "", now), ScheduleError);
});

test("refuses an unparseable date", () => {
  assert.throws(() => resolveSendTime("next tuesday", "UTC", now), ScheduleError);
});

test("accepts ISO as well as space-separated input", () => {
  const a = resolveSendTime("2026-09-01T09:30", "UTC", now);
  const b = resolveSendTime("2026-09-01 09:30", "UTC", now);
  assert.equal(a.utc, b.utc);
});
