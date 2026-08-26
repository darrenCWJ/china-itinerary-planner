import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GeoNamesCredit } from "@/components/plan/GeoNamesCredit";
import { BriefingView } from "@/components/trip/BriefingView";
import { buildBriefing } from "@/lib/briefing";
import { getBriefingByCode, getTrip, storeMode } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** A bearer-token URL must never end up in a search index. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ code: string }> };

export default async function BriefingPage({ params }: Props) {
  const { code } = await params;
  if (storeMode() === "unavailable") notFound();

  const record = await getBriefingByCode(code);
  if (!record) notFound();

  // No requesting member: getTrip attaches the join code for members, and this
  // page is readable by anyone holding the link.
  const payload = await getTrip(record.tripId);
  if (!payload) notFound();

  const briefing = buildBriefing(payload, {
    redacted: true,
    includeBookings: record.includeBookings,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BriefingView briefing={briefing} />
      <footer className="mt-12 border-t border-[var(--line-1)] pt-4 text-xs text-[var(--ink-2)]">
        A read-only trip briefing. Ask whoever shared this link if you need the booking details.
        {/*
          A bearer link a non-member holds: they never sign in, never open
          /plan, and the briefing above is nothing but GeoNames city names and
          the Wikipedia-derived blurbs.
        */}
        <div className="mt-3">
          <GeoNamesCredit />
        </div>
      </footer>
    </main>
  );
}
