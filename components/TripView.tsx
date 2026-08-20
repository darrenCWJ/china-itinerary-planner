"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CountryHero } from "@/components/shell/CountryHero";
import { useSetShellTrip } from "@/components/shell/ShellTripContext";
import type { SettlementDraft } from "@/components/trip/BalancesCard";
import type { ExpenseDraft } from "@/components/trip/ExpenseForm";
import { GuestTripView } from "@/components/trip/GuestTripView";
import { JoinClaimDialog } from "@/components/trip/JoinClaimDialog";
import type { JournalDraft } from "@/components/trip/JournalSection";
import { KitTab } from "@/components/trip/KitTab";
import { MoneyTab } from "@/components/trip/MoneyTab";
import { PlanTab } from "@/components/trip/PlanTab";
import { PrivateGate } from "@/components/trip/PrivateGate";
import type { TicketDraft } from "@/components/trip/TicketsTab";
import { TodayTab } from "@/components/trip/TodayTab";
import { authClient } from "@/lib/authClient";
import { SEASONS } from "@/lib/meta";
import { forgetMyTrip } from "@/lib/myTrips";
import { TRIP_NAV, toTripTabId, type TripTabId } from "@/lib/nav";
import type { PlanOp } from "@/lib/planOps";
import { tripCountry, type GuestTripPayload } from "@/lib/tripShared";
import { useTripPayload } from "@/lib/useTripPayload";

export function TripView({ tripId }: { tripId: string }) {
  // Every read and write of the trip payload goes through this one accessor
  // (spec §7 C4) — this component does not fetch trip data itself. URLs are
  // handed to mutate(); constructing one here is not a fetch.
  const { payload, guestView, loadState, forcedAt, mutate, toggleCheck, joinTrip, loadClaimable, probeCode } =
    useTripPayload(tripId);
  const [claimable, setClaimable] = useState<string[] | null>(null);
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const myName = payload?.myMemberName ?? "";
  /** Pre-accounts identity on this device — powers the claim preselect + banner. */
  const legacyName =
    typeof window !== "undefined" ? localStorage.getItem(`cip-member-${tripId}`) : null;

  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  /**
   * Tab state lives in `?tab=` (J2), not component state: deep-linkable,
   * survives a refresh, and the rail, this strip and a future bottom bar all
   * read the same value. `toTripTabId` narrows anything unrecognised to Plan.
   */
  const tab = toTripTabId(searchParams.get("tab"));
  const setTab = useCallback(
    (next: TripTabId) => {
      // push, not replace, to match the rail's <Link> — Back should walk tabs.
      router.push(`${pathname}?tab=${next}`, { scroll: false });
    },
    [pathname, router]
  );

  const isMember = useMemo(
    () => Boolean(payload?.members.some((m) => m.name === myName)),
    [payload, myName]
  );

  useEffect(() => {
    if (loadState === "not-found") forgetMyTrip(tripId);
  }, [loadState, tripId]);

  // Publish the open trip so the shell header's crew, share and trip name light
  // up from this page's single accessor call rather than fetching again (J3).
  const setShellTrip = useSetShellTrip();
  useEffect(() => {
    setShellTrip(payload ? { tripId, payload, mutate } : null);
  }, [setShellTrip, tripId, payload, mutate]);
  // Unmount only — deliberately separate from the effect above, which re-runs on
  // every poll. Returning this as that effect's cleanup would blank the header
  // and repopulate it on each payload change.
  useEffect(() => () => setShellTrip(null), [setShellTrip]);

  const onToggleCheck = (key: string, checked: boolean) => void toggleCheck(key, checked, myName);

  const showClaimable = async () => setClaimable(await loadClaimable());

  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const planOp = (op: PlanOp) => mutate(`/api/trips/${tripId}/plan`, jsonInit("POST", { op }));
  const addTicket = (ticket: TicketDraft) =>
    mutate(`/api/trips/${tripId}/tickets`, jsonInit("POST", { ticket }));
  const updateTicket = (ticketId: string, ticket: TicketDraft) =>
    mutate(`/api/trips/${tripId}/tickets/${ticketId}`, jsonInit("PATCH", { ticket }));
  const deleteTicket = (ticketId: string) =>
    mutate(`/api/trips/${tripId}/tickets/${ticketId}`, { method: "DELETE" });

  const addExpense = (expense: ExpenseDraft) =>
    mutate(`/api/trips/${tripId}/expenses`, jsonInit("POST", { expense }));
  const updateExpense = (expenseId: string, expense: ExpenseDraft) =>
    mutate(`/api/trips/${tripId}/expenses/${expenseId}`, jsonInit("PATCH", { expense }));
  const deleteExpense = (expenseId: string) =>
    mutate(`/api/trips/${tripId}/expenses/${expenseId}`, { method: "DELETE" });
  const addSettlement = (settlement: SettlementDraft) =>
    mutate(`/api/trips/${tripId}/settlements`, jsonInit("POST", { settlement }));
  const deleteSettlement = (settlementId: string) =>
    mutate(`/api/trips/${tripId}/settlements/${settlementId}`, { method: "DELETE" });
  const saveCurrency = (home: string | null, rates: Record<string, number>) =>
    mutate(`/api/trips/${tripId}/currency`, jsonInit("PUT", { home, rates }));
  const addJournal = (entry: JournalDraft) =>
    mutate(`/api/trips/${tripId}/journal`, jsonInit("POST", { entry }));
  const updateJournal = (entryId: string, entry: Partial<JournalDraft>) =>
    mutate(`/api/trips/${tripId}/journal/${entryId}`, jsonInit("PATCH", { entry }));
  const deleteJournal = (entryId: string) =>
    mutate(`/api/trips/${tripId}/journal/${entryId}`, { method: "DELETE" });

  if (loadState === "loading") {
    return (
      <PageMain>
        <p className="mt-16 text-center text-sm text-[var(--ink-2)]">Loading trip…</p>
      </PageMain>
    );
  }

  if (loadState === "private") {
    return (
      <PageMain>
        <PrivateGate onSubmitCode={probeCode} />
      </PageMain>
    );
  }

  if (loadState === "guest" && guestView) {
    return (
      <PageMain>
        <GuestHeader view={guestView} />
        {!sessionPending && session && claimable !== null && (
          <JoinClaimDialog claimable={claimable} legacyName={legacyName} onJoin={joinTrip} />
        )}
        {!sessionPending && session && claimable === null && (
          <button
            type="button"
            onClick={() => void showClaimable()}
            className="mt-6 rounded-lg bg-seal px-5 py-2 text-sm font-semibold text-white"
          >
            Join this trip
          </button>
        )}
        {!sessionPending && !session && (
          <p className="mt-6 text-sm text-[var(--ink-2)]">
            <Link href={`/login?next=/trip/${tripId}`} className="text-[var(--accent-ink)] hover:underline">
              Sign in
            </Link>{" "}
            to join and edit this trip.
          </p>
        )}
        {legacyName && (
          <p className="mt-2 rounded-lg border border-dashed border-seal/50 bg-[var(--paper)] px-4 py-2 text-xs text-[var(--ink-2)]">
            This device used to edit as <b>{legacyName}</b> — create an account and claim
            that name to keep editing.
          </p>
        )}
        <GuestTripView view={guestView} />
      </PageMain>
    );
  }

  if (loadState === "not-found" || !payload) {
    return (
      <PageMain>
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-8 text-center">
          <p className="font-display text-xl font-bold">Trip not found</p>
          <p className="mt-2 text-sm text-[var(--ink-2)]">
            This trip may have been created on another machine or the link is wrong.
          </p>
          <Link href="/" className="mt-4 inline-block rounded-lg bg-[var(--accent-ink)] px-5 py-2 text-sm font-semibold text-white">
            Plan a new trip
          </Link>
        </div>
      </PageMain>
    );
  }

  const { data } = payload;
  const seasonMeta = SEASONS.find((s) => s.id === data.input.season);
  const checkedBy = new Map(payload.checks.map((c) => [c.key, c.by]));
  const todayIndex = currentDayIndex(data.startDate, data.plan.days.length);

  return (
    <PageMain>
      {/*
        Slimmer than before: the crew count, invite button and join-code strip
        moved to the header's crew and share menus, so the hero states what the
        trip *is* and stops carrying actions.

        The accent band survives as the hero's ground, which is what a photograph
        falls back to (see CountryHero) — it is not decoration to be dropped.
        `eager`: this is the first thing on the page, so it is the LCP.
      */}
      <CountryHero
        countryCode={tripCountry(data)}
        eager
        className="rounded-2xl bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] p-6 text-white sm:p-8"
      >
        <span aria-hidden className="seal-round absolute right-6 top-6 hidden border-white/80 text-white/90 sm:inline-flex">
          同行
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--line-1)]">Shared trip</p>
        <h1 className="mt-2 font-display text-3xl font-bold">{data.tripName}</h1>
        <p className="mt-3 font-mono text-sm tracking-wider text-[var(--line-1)]">
          {data.destinationNames.map((n) => n.toUpperCase()).join(" → ")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/15 px-3 py-1">
            {seasonMeta?.emoji} {seasonMeta?.label}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1">📅 {data.plan.days.length} days</span>
          {data.startDate && (
            <span className="rounded-full bg-white/15 px-3 py-1">🚩 from {data.startDate}</span>
          )}
        </div>
      </CountryHero>

      {/*
        Below md only: the shell's rail is the desktop nav, and the mobile bottom
        bar replaces this strip in the follow-up spec. Renders from TRIP_NAV, so
        this is a second *view*, not a second list (C1).
      */}
      <nav className="mt-6 flex flex-wrap gap-2 md:hidden print:hidden" aria-label="Trip sections">
        {TRIP_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-pressed={tab === item.id}
            aria-label={item.ariaLabel}
            className={`min-h-[var(--tap-min)] rounded-full px-4 text-sm font-medium transition-colors ${
              tab === item.id ? "bg-[var(--accent-ink)] text-white" : "bg-[var(--paper)] text-[var(--ink-2)] hover:bg-[var(--line-1)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "plan" && (
        <PlanTab
          plan={data.plan}
          startDate={data.startDate}
          country={tripCountry(data)}
          season={data.input.season}
          tickets={payload.tickets}
          checkedBy={checkedBy}
          isMember={isMember}
          todayIndex={todayIndex}
          onToggle={onToggleCheck}
          onPlanOp={planOp}
          tripId={tripId}
          payload={payload}
          forcedAt={forcedAt}
          mutate={mutate}
        />
      )}

      {tab === "today" && (
        <TodayTab
          payload={payload}
          myName={myName}
          isMember={isMember}
          onToggle={onToggleCheck}
          onAddJournal={addJournal}
          onUpdateJournal={updateJournal}
          onDeleteJournal={deleteJournal}
          onOpenTab={setTab}
        />
      )}

      {tab === "money" && (
        <MoneyTab
          expenses={payload.expenses}
          settlements={payload.settlements}
          currencySettings={payload.currencySettings}
          members={payload.members.map((m) => m.name)}
          myName={myName}
          isMember={isMember}
          onAddExpense={addExpense}
          onUpdateExpense={updateExpense}
          onDeleteExpense={deleteExpense}
          onAddSettlement={addSettlement}
          onDeleteSettlement={deleteSettlement}
          onSaveCurrency={saveCurrency}
        />
      )}

      {tab === "kit" && (
        <KitTab
          tickets={payload.tickets}
          hasStartDate={Boolean(data.startDate)}
          onAddTicket={addTicket}
          onUpdateTicket={updateTicket}
          onDeleteTicket={deleteTicket}
          packing={data.packing}
          checkedBy={checkedBy}
          onToggleCheck={onToggleCheck}
          isMember={isMember}
        />
      )}
    </PageMain>
  );
}

/**
 * The page's own `<main>`. AppShell deliberately does not render one — every
 * page supplies its own, and two would nest a landmark the spec allows one of.
 *
 * The eyebrow strip that used to live here is gone (J5): the shell header now
 * carries the trip name and crew, which is what "shared trip mode" was standing
 * in for.
 */
function PageMain({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-4xl px-4 pb-16 pt-6">{children}</main>;
}

/**
 * Trimmed header for join-code guests: no invite chrome, no join code.
 *
 * No `CountryHero` either, and not by oversight: `GuestTripPayload` carries no
 * country, so the only country this could name is a guessed one. Defaulting to
 * CN would put the Great Wall behind a Japan trip, which is worse than a plain
 * band. Adding the field to the guest payload is a server change and outside
 * this task's file set.
 */
function GuestHeader({ view }: { view: GuestTripPayload }) {
  const seasonMeta = SEASONS.find((s) => s.id === view.season);
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] p-6 text-white sm:p-8">
      <span aria-hidden className="seal-round absolute right-6 top-6 hidden border-white/80 text-white/90 sm:inline-flex">
        同行
      </span>
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--line-1)]">Shared trip</p>
      <h1 className="mt-2 font-display text-3xl font-bold">{view.tripName}</h1>
      <p className="mt-3 font-mono text-sm tracking-wider text-[var(--line-1)]">
        {view.destinationNames.map((n) => n.toUpperCase()).join(" → ")}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-white/15 px-3 py-1">
          {seasonMeta?.emoji} {seasonMeta?.label}
        </span>
        <span className="rounded-full bg-white/15 px-3 py-1">📅 {view.days} days</span>
        {view.startDate && (
          <span className="rounded-full bg-white/15 px-3 py-1">🚩 from {view.startDate}</span>
        )}
        <span className="rounded-full bg-white/15 px-3 py-1">
          👥 {view.memberCount} member{view.memberCount > 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

function currentDayIndex(startDate: string | null, totalDays: number): number | null {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000) + 1;
  return diffDays >= 1 && diffDays <= totalDays ? diffDays : null;
}
