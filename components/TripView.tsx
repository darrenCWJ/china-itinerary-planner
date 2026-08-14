"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefingShare } from "@/components/trip/BriefingShare";
import { BriefingView } from "@/components/trip/BriefingView";
import { DayCard } from "@/components/trip/DayCard";
import { TicketsTab, type TicketDraft } from "@/components/trip/TicketsTab";
import { MoneyTab } from "@/components/trip/MoneyTab";
import type { ExpenseDraft } from "@/components/trip/ExpenseForm";
import type { SettlementDraft } from "@/components/trip/BalancesCard";
import { TrackerTab } from "@/components/trip/TrackerTab";
import type { JournalDraft } from "@/components/trip/JournalSection";
import { buildBriefing } from "@/lib/briefing";
import { SEASONS } from "@/lib/meta";
import { forgetMyTrip, saveMyTrip } from "@/lib/myTrips";
import type { PlanOp } from "@/lib/planOps";
import { dayDate, sortTickets, ticketOnDate } from "@/lib/tickets";
import { packingCheckKey, type TripPayload } from "@/lib/tripShared";

const POLL_MS = 4000;
const TABS = ["Itinerary", "Tracker", "Money", "Tickets", "Packing", "Crew", "Briefing"] as const;
type Tab = (typeof TABS)[number];

type LoadState = "loading" | "ready" | "not-found";

export function TripView({ tripId }: { tripId: string }) {
  const [payload, setPayload] = useState<TripPayload | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [myName, setMyName] = useState<string>("");
  const [tab, setTab] = useState<Tab>("Itinerary");
  const [copied, setCopied] = useState(false);

  // Add-day control state
  const [newDayDest, setNewDayDest] = useState("");
  const [addingDay, setAddingDay] = useState(false);
  const [addDayError, setAddDayError] = useState<string | null>(null);

  // Join form state
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(`cip-member-${tripId}`) ?? "";
    setMyName(stored);
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) setJoinCode(code);
  }, [tripId]);

  // Never regress to older data: late responses are dropped unless forced
  // (forced = identity changes or post-error reconciliation).
  const applyPayload = useCallback((fresh: TripPayload, force = false) => {
    setPayload((prev) => (!force && prev && prev.version >= fresh.version ? prev : fresh));
  }, []);

  const fetchTrip = useCallback(
    async (member: string, force = false) => {
      const query = member ? `?member=${encodeURIComponent(member)}` : "";
      const res = await fetch(`/api/trips/${tripId}${query}`, { cache: "no-store" });
      if (res.status === 404) {
        setLoadState("not-found");
        return;
      }
      if (!res.ok) return;
      const fresh: TripPayload = await res.json();
      applyPayload(fresh, force);
      setLoadState("ready");
    },
    [tripId, applyPayload]
  );

  useEffect(() => {
    void fetchTrip(myName);
  }, [fetchTrip, myName]);

  // Live sync: poll while the tab is visible so every member sees updates,
  // and refetch immediately when the tab regains focus.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void fetchTrip(myName);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void fetchTrip(myName);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchTrip, myName]);

  const isMember = useMemo(
    () => Boolean(payload?.members.some((m) => m.name === myName)),
    [payload, myName]
  );

  // Keep the homepage dashboard fresh: remember trips this device is part
  // of (name/date/cities update on every visit), forget deleted ones.
  useEffect(() => {
    if (!payload || !isMember) return;
    saveMyTrip({
      id: tripId,
      name: payload.data.tripName,
      startDate: payload.data.startDate,
      days: payload.data.plan.days.length,
      destinations: payload.data.destinationNames,
      role: "member",
      memberName: myName,
    });
  }, [payload, isMember, tripId, myName]);

  useEffect(() => {
    if (loadState === "not-found") forgetMyTrip(tripId);
  }, [loadState, tripId]);

  const join = async () => {
    if (!joinName.trim() || !joinCode.trim()) {
      setJoinError("Enter both your name and the join code.");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: joinName.trim(), code: joinCode.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setJoinError(typeof json.error === "string" ? json.error : "Couldn't join the trip.");
        return;
      }
      localStorage.setItem(`cip-member-${tripId}`, joinName.trim());
      setMyName(joinName.trim());
      applyPayload(json as TripPayload, true);
    } catch {
      setJoinError("Couldn't reach the server — try again.");
    } finally {
      setJoining(false);
    }
  };

  const toggleCheck = async (key: string, checked: boolean) => {
    if (!payload || !isMember) return;
    // Optimistic update; the server response is the source of truth.
    setPayload({
      ...payload,
      checks: checked
        ? [...payload.checks.filter((c) => c.key !== key), { key, by: myName }]
        : payload.checks.filter((c) => c.key !== key),
    });
    try {
      const res = await fetch(`/api/trips/${tripId}/checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName: myName, key, checked }),
      });
      if (res.ok) {
        applyPayload((await res.json()) as TripPayload);
      } else {
        // The optimistic update kept the old version, so polls would never
        // reconcile it — force a fresh copy of the server state.
        void fetchTrip(myName, true);
      }
    } catch {
      void fetchTrip(myName, true);
    }
  };

  // Shared mutation path: POST/PATCH/DELETE, apply the fresh payload on
  // success, reconcile via a forced refetch on failure. Returns an error
  // message for the calling form, or null when the change stuck.
  const mutate = useCallback(
    async (url: string, init: RequestInit): Promise<string | null> => {
      try {
        const res = await fetch(url, init);
        const json: unknown = await res.json();
        if (!res.ok) {
          void fetchTrip(myName, true);
          const message = (json as { error?: unknown }).error;
          return typeof message === "string" ? message : "Couldn't save that change.";
        }
        applyPayload(json as TripPayload);
        return null;
      } catch {
        return "Couldn't reach the server — try again.";
      }
    },
    [fetchTrip, myName, applyPayload]
  );

  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const planOp = (op: PlanOp) =>
    mutate(`/api/trips/${tripId}/plan`, jsonInit("POST", { memberName: myName, op }));
  const addTicket = (ticket: TicketDraft) =>
    mutate(`/api/trips/${tripId}/tickets`, jsonInit("POST", { memberName: myName, ticket }));
  const updateTicket = (ticketId: string, ticket: TicketDraft) =>
    mutate(`/api/trips/${tripId}/tickets/${ticketId}`, jsonInit("PATCH", { memberName: myName, ticket }));
  const deleteTicket = (ticketId: string) =>
    mutate(`/api/trips/${tripId}/tickets/${ticketId}?member=${encodeURIComponent(myName)}`, {
      method: "DELETE",
    });

  const addExpense = (expense: ExpenseDraft) =>
    mutate(`/api/trips/${tripId}/expenses`, jsonInit("POST", { memberName: myName, expense }));
  const updateExpense = (expenseId: string, expense: ExpenseDraft) =>
    mutate(
      `/api/trips/${tripId}/expenses/${expenseId}`,
      jsonInit("PATCH", { memberName: myName, expense })
    );
  const deleteExpense = (expenseId: string) =>
    mutate(`/api/trips/${tripId}/expenses/${expenseId}?member=${encodeURIComponent(myName)}`, {
      method: "DELETE",
    });
  const addSettlement = (settlement: SettlementDraft) =>
    mutate(`/api/trips/${tripId}/settlements`, jsonInit("POST", { memberName: myName, settlement }));
  const deleteSettlement = (settlementId: string) =>
    mutate(
      `/api/trips/${tripId}/settlements/${settlementId}?member=${encodeURIComponent(myName)}`,
      { method: "DELETE" }
    );
  const saveCurrency = (home: string | null, rates: Record<string, number>) =>
    mutate(`/api/trips/${tripId}/currency`, jsonInit("PUT", { memberName: myName, home, rates }));
  const addJournal = (entry: JournalDraft) =>
    mutate(`/api/trips/${tripId}/journal`, jsonInit("POST", { memberName: myName, entry }));
  const updateJournal = (entryId: string, entry: Partial<JournalDraft>) =>
    mutate(
      `/api/trips/${tripId}/journal/${entryId}`,
      jsonInit("PATCH", { memberName: myName, entry })
    );
  const deleteJournal = (entryId: string) =>
    mutate(`/api/trips/${tripId}/journal/${entryId}?member=${encodeURIComponent(myName)}`, {
      method: "DELETE",
    });

  const copyShareLink = async () => {
    if (!payload?.joinCode) return;
    const url = `${window.location.origin}/trip/${tripId}?code=${payload.joinCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the code is displayed anyway.
    }
  };

  if (loadState === "loading") {
    return (
      <Shell>
        <p className="mt-16 text-center text-sm text-ink-soft">Loading trip…</p>
      </Shell>
    );
  }

  if (loadState === "not-found" || !payload) {
    return (
      <Shell>
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-sky bg-paper p-8 text-center">
          <p className="font-display text-xl font-bold">Trip not found</p>
          <p className="mt-2 text-sm text-ink-soft">
            This trip may have been created on another machine or the link is wrong.
          </p>
          <Link href="/" className="mt-4 inline-block rounded-lg bg-rail px-5 py-2 text-sm font-semibold text-white">
            Plan a new trip
          </Link>
        </div>
      </Shell>
    );
  }

  const { data } = payload;
  const seasonMeta = SEASONS.find((s) => s.id === data.input.season);
  const checkedBy = new Map(payload.checks.map((c) => [c.key, c.by]));
  const todayIndex = currentDayIndex(data.startDate, data.plan.days.length);

  const destinationOptions = (() => {
    const seen = new Map<string, string>();
    data.plan.days.forEach((d) => seen.set(d.destinationId, d.destinationName));
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  })();

  const addDay = async () => {
    if (addingDay) return;
    setAddingDay(true);
    setAddDayError(null);
    const err = await planOp({
      op: "addDay",
      destinationId: newDayDest || undefined,
    });
    setAddingDay(false);
    if (err) setAddDayError(err);
  };

  return (
    <Shell>
      <div className="relative overflow-hidden rounded-2xl bg-rail-deep p-6 text-white sm:p-8">
        <span aria-hidden className="seal-round absolute right-6 top-6 hidden border-white/80 text-white/90 sm:inline-flex">
          同行
        </span>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-sky">Shared trip</p>
        <h1 className="mt-2 font-display text-3xl font-bold">{data.tripName}</h1>
        <p className="mt-3 font-mono text-sm tracking-wider text-sky">
          {data.destinationNames.map((n) => n.toUpperCase()).join(" → ")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/15 px-3 py-1">
            {seasonMeta?.emoji} {seasonMeta?.label}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1">📅 {data.input.days} days</span>
          {data.startDate && (
            <span className="rounded-full bg-white/15 px-3 py-1">🚩 from {data.startDate}</span>
          )}
          <span className="rounded-full bg-white/15 px-3 py-1">
            👥 {payload.members.length} member{payload.members.length > 1 ? "s" : ""}
          </span>
        </div>
        {isMember && payload.joinCode && (
          <div className="mt-5 flex flex-wrap items-center gap-3 print:hidden">
            <button
              type="button"
              onClick={() => void copyShareLink()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-rail-deep transition-colors hover:bg-sky"
            >
              {copied ? "✓ Link copied" : "🔗 Copy invite link"}
            </button>
            <span className="font-mono text-sm tracking-[0.25em] text-sky">
              CODE {payload.joinCode}
            </span>
          </div>
        )}
      </div>

      {!isMember && (
        <div className="mt-6 rounded-xl border-2 border-dashed border-seal/50 bg-paper p-5">
          <h2 className="font-display text-lg font-semibold">Join this trip</h2>
          <p className="mt-1 text-sm text-ink-soft">
            You&apos;re viewing as a guest. Join with the code to tick things off together.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-ink-soft">
              Your name
              <input
                type="text"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                maxLength={30}
                className="mt-1 block w-44 rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
              />
            </label>
            <label className="text-xs font-medium text-ink-soft">
              Join code
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={12}
                className="mt-1 block w-36 rounded-lg border border-sky bg-mist px-3 py-2 font-mono text-sm tracking-widest text-ink focus-visible:outline-2 focus-visible:outline-rail"
              />
            </label>
            <button
              type="button"
              onClick={() => void join()}
              disabled={joining}
              className="rounded-lg bg-seal px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-seal/85 disabled:opacity-50"
            >
              {joining ? "Joining…" : "Join trip"}
            </button>
            {joinError && <span className="text-xs text-seal">{joinError}</span>}
          </div>
        </div>
      )}

      <nav className="mt-6 flex flex-wrap gap-2 print:hidden" aria-label="Trip sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "bg-rail text-white" : "bg-paper text-ink-soft hover:bg-sky"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Itinerary" && (
        <div className="mt-5 space-y-5">
          {!data.startDate && payload.tickets.some((t) => t.date) && (
            <p className="rounded-lg border border-dashed border-rail/40 bg-paper px-4 py-2 text-xs text-ink-soft">
              💡 Set a trip start date to see tickets pinned to their days.
            </p>
          )}
          {data.plan.days.map((day) => {
            const date = dayDate(data.startDate, day.day);
            const dayTickets = date
              ? sortTickets(payload.tickets.filter((t) => ticketOnDate(t, date)))
              : [];
            return (
              <DayCard
                key={day.day}
                day={day}
                isToday={todayIndex === day.day}
                tickets={dayTickets}
                checkedBy={checkedBy}
                isMember={isMember}
                onToggle={(key, checked) => void toggleCheck(key, checked)}
                onOp={planOp}
              />
            );
          })}
          {isMember && (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => void addDay()}
                disabled={addingDay}
                className="rounded-lg border border-dashed border-rail/50 px-4 py-2 text-sm font-semibold text-rail transition-colors hover:bg-sky disabled:opacity-40"
              >
                {addingDay ? "Adding…" : "+ Add day"}
              </button>
              <span className="text-xs text-ink-soft">in</span>
              <select
                value={newDayDest}
                onChange={(e) => setNewDayDest(e.target.value)}
                aria-label="Destination for the new day"
                className="rounded-lg border border-sky bg-paper px-2 py-1.5 text-sm text-ink"
              >
                <option value="">Same as last day</option>
                {destinationOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {addDayError && <span className="text-xs text-seal">{addDayError}</span>}
            </div>
          )}
        </div>
      )}

      {tab === "Tracker" && (
        <TrackerTab
          payload={payload}
          myName={myName}
          isMember={isMember}
          onToggle={(key, checked) => void toggleCheck(key, checked)}
          onAddJournal={addJournal}
          onUpdateJournal={updateJournal}
          onDeleteJournal={deleteJournal}
          onOpenMoney={() => setTab("Money")}
        />
      )}

      {tab === "Money" && (
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

      {tab === "Tickets" && (
        <TicketsTab
          tickets={payload.tickets}
          isMember={isMember}
          hasStartDate={Boolean(data.startDate)}
          onAdd={addTicket}
          onUpdate={updateTicket}
          onDelete={deleteTicket}
        />
      )}

      {tab === "Packing" && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {data.packing.map((group) => (
            <div key={group.title} className="rounded-xl border border-sky bg-paper p-4">
              <p className="font-semibold">
                <span aria-hidden>{group.emoji}</span> {group.title}
              </p>
              <ul className="mt-2 space-y-1.5">
                {group.items.map((item) => {
                  const key = packingCheckKey(group.title, item);
                  const by = checkedBy.get(key);
                  return (
                    <li key={item}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={by !== undefined}
                          disabled={!isMember}
                          onChange={(e) => void toggleCheck(key, e.target.checked)}
                          className="mt-0.5 h-4 w-4 accent-rail"
                        />
                        <span className={by ? "text-ink-soft line-through" : ""}>
                          {item}
                          {by && <span className="ml-1 text-[11px] text-rail no-underline"> · {by}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {tab === "Crew" && (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-sky bg-paper p-5">
            <h2 className="font-display text-lg font-semibold">
              Crew ({payload.members.length})
            </h2>
            <ul className="mt-3 space-y-2">
              {payload.members.map((m) => (
                <li key={m.name} className="flex items-center gap-3 text-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky font-semibold text-rail-deep">
                    {m.name[0]?.toUpperCase()}
                  </span>
                  <span className="font-medium">{m.name}</span>
                  {m.name === myName && (
                    <span className="rounded bg-sky px-1.5 py-0.5 text-[10px] font-mono text-rail-deep">
                      YOU
                    </span>
                  )}
                  <span className="ml-auto text-xs text-ink-soft">
                    joined {new Date(m.joinedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {isMember && payload.joinCode && (
            <div className="rounded-xl border border-sky bg-paper p-5 text-sm">
              <p className="font-semibold">Invite more people</p>
              <p className="mt-1 text-ink-soft">
                Share the invite link, or tell them to open this page and enter code{" "}
                <span className="font-mono font-semibold tracking-widest text-seal">
                  {payload.joinCode}
                </span>
                .
              </p>
            </div>
          )}
          <div className="rounded-xl border border-sky bg-paper p-5 text-sm">
            <p className="font-semibold">Good to know</p>
            <ul className="mt-2 space-y-1.5">
              {data.plan.tips.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span aria-hidden className="text-seal">※</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === "Briefing" && (
        <div className="mt-5 space-y-6">
          <BriefingShare tripId={tripId} memberName={myName} />
          <BriefingView
            briefing={buildBriefing(payload, { redacted: false, includeBookings: true })}
          />
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-sky bg-paper print:hidden">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-seal font-kai text-xl text-white">
              游
            </span>
            <div>
              <p className="font-display text-xl font-bold leading-tight">
                China Itinerary Planner
              </p>
              <p className="text-xs text-ink-soft">Shared trip mode — live for every member</p>
            </div>
          </Link>
          <span className="hidden font-kai text-lg text-seal sm:block">一路平安</span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 pt-6">{children}</main>
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
