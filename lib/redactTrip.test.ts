import { describe, expect, test } from "vitest";
import { guestTripView } from "./redactTrip";
import { fullPayload } from "./tripFixtures";

describe("guestTripView", () => {
  test("contains exactly the whitelisted fields", () => {
    const payload = fullPayload();
    const view = guestTripView(payload);
    expect(Object.keys(view).sort()).toEqual(
      [
        "country",
        "days",
        "destinationNames",
        "guest",
        "id",
        "memberCount",
        "packing",
        "planDays",
        "season",
        "startDate",
        "tripName",
        "version",
      ].sort()
    );
    expect(view.guest).toBe(true);
    expect(view.memberCount).toBe(2);
    expect(view.planDays[0].items[0].title).toBe("Great Wall");
    expect(view.id).toBe("trip-1");
    expect(view.version).toBe(7);
    expect(view.tripName).toBe("Family Trip");
    expect(view.startDate).toBe("2026-12-20");
    // The plan's length, not the wizard's original request. These are the same
    // number only until someone adds a day, after which the header said one
    // thing and the day list below it showed another — on the same screen.
    expect(view.days).toBe(1);
    expect(view.days).toBe(view.planDays.length);
    // Carried so the guest header can render the right chop rather than
    // defaulting to China's.
    expect(view.country).toBe("CN");
    expect(view.season).toBe("winter");
    expect(view.destinationNames).toEqual(["Beijing"]);
    expect(view.packing).toEqual(payload.data.packing);
  });

  test("leaks nothing sensitive anywhere in the serialized view", () => {
    const json = JSON.stringify(guestTripView(fullPayload()));
    for (const secret of [
      "SECRET",      // join code
      "PNR-XYZ",     // ticket confirmation
      "Hotpot",      // expense
      "diary",       // journal
      "Ada",         // member names / attribution
      "item:i1",     // check keys
      "SGD",         // currency settings
      "secret member tip", // tips are member-facing
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});
