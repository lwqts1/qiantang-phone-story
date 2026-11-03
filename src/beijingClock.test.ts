import { expect, test } from "vitest";
import { beijingClock } from "./beijingClock";

test("Beijing date rolls over at UTC 16:00 without a 24:00 hour", () => {
  expect(beijingClock(new Date("2026-12-31T15:59:59Z"))).toEqual({ date: "2026-12-31", time: "23:59" });
  expect(beijingClock(new Date("2026-12-31T16:00:00Z"))).toEqual({ date: "2027-01-01", time: "00:00" });
});
