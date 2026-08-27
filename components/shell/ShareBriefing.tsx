"use client";

import { BriefingView } from "@/components/trip/BriefingView";
import { buildBriefing } from "@/lib/briefing";
import type { TripPayload } from "@/lib/tripShared";

/**
 * The briefing behind Share › "View briefing", split out of ShareMenu so it can
 * be loaded as its own chunk.
 *
 * It is one line of JSX, and that is the point: the split is about the module
 * graph, not the markup. `buildBriefing` resolves the trip country's gap note
 * (T28), so it reaches lib/countryProfile.ts and the 70 KB CC0 facts artifact.
 * ShareMenu is mounted by AppShell, which app/layout.tsx mounts on every route
 * — so importing `buildBriefing` there put those bytes, plus BriefingView and
 * its charts, into the shared client chunk of /login and of the
 * unauthenticated /b/[code] briefing, neither of which can ever render this.
 *
 * Lazily loading it does not make the bytes free for a member who opens the
 * briefing; it makes them free for everyone who does not. The briefing sits
 * behind two deliberate actions — open the Share panel, then expand the
 * disclosure — so a chunk fetched at that moment is the cheapest possible
 * place to pay.
 *
 * The briefing is rebuilt on every render rather than memoised, which is what
 * it did while it lived inline in ShareMenu: a briefing is a per-request view
 * of the trip and a stale one would keep showing a plan the crew has edited.
 */
export function ShareBriefing({ payload }: { payload: TripPayload }) {
  return (
    <BriefingView
      /*
        The same options the old Briefing tab passed. Members see the
        unredacted briefing with bookings; the redacted variant is what
        /b/[code] serves to the public.
      */
      briefing={buildBriefing(payload, { redacted: false, includeBookings: true })}
    />
  );
}
