"use client";

import { GeoNamesCredit } from "@/components/plan/GeoNamesCredit";
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
    <>
      <BriefingView
        /*
          The same options the old Briefing tab passed. Members see the
          unredacted briefing with bookings; the redacted variant is what
          /b/[code] serves to the public.
        */
        briefing={buildBriefing(payload, { redacted: false, includeBookings: true })}
      />
      {/*
        `BriefingView` renders `destinationName` on every day panel, which for a
        non-Chinese trip is GeoNames data under CC BY 4.0. Its other mount,
        app/b/[code]/page.tsx, credits it in that page's footer; this one had no
        crediting ancestor at all — ShareMenu → AppShell → app/layout.tsx
        renders none, and the layout wraps every route. The trip page underneath
        happens to carry the credit at its foot, but that is a runtime fact
        about which page can publish a trip into ShellTripContext, not a
        structural guarantee, and a licence obligation discharged by coincidence
        is one nobody can check. C7 in lib/contracts.test.ts now walks the mount
        graph and would refuse an allowlist entry claiming otherwise.
      */}
      <div className="mt-6">
        <GeoNamesCredit />
      </div>
    </>
  );
}
