"use client";

import { useState } from "react";
import { TICKET_KINDS, ticketKindMeta } from "@/lib/meta";
import { sortTickets } from "@/lib/tickets";
import type { Ticket, TicketKind } from "@/lib/tripShared";

/** Form payload sent to the tickets API — empty strings become null. */
export interface TicketDraft {
  kind: TicketKind;
  title: string;
  date: string | null;
  endDate: string | null;
  time: string | null;
  from: string | null;
  to: string | null;
  confirmation: string | null;
  price: string | null;
  notes: string | null;
}

interface TicketsTabProps {
  tickets: Ticket[];
  isMember: boolean;
  hasStartDate: boolean;
  onAdd: (draft: TicketDraft) => Promise<string | null>;
  onUpdate: (ticketId: string, draft: TicketDraft) => Promise<string | null>;
  onDelete: (ticketId: string) => Promise<string | null>;
}

export function TicketsTab({
  tickets,
  isMember,
  hasStartDate,
  onAdd,
  onUpdate,
  onDelete,
}: TicketsTabProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = sortTickets(tickets);

  const run = async (fn: () => Promise<string | null>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    const err = await fn();
    setPending(false);
    if (err) {
      setError(err);
    } else {
      setAdding(false);
      setEditingId(null);
    }
  };

  return (
    <div className="mt-5 space-y-4">
      {!hasStartDate && sorted.some((t) => t.date) && (
        <p className="rounded-lg border border-dashed border-rail/40 bg-paper px-4 py-2 text-xs text-ink-soft">
          💡 Set a trip start date to see tickets pinned to their itinerary days.
        </p>
      )}

      {sorted.length === 0 && !adding && (
        <div className="rounded-xl border-2 border-dashed border-sky bg-paper p-8 text-center text-sm text-ink-soft">
          No tickets yet. Add your flights, trains, hotels and bookings so the whole crew can see
          them.
        </div>
      )}

      {sorted.map((t) =>
        editingId === t.id ? (
          <TicketForm
            key={t.id}
            initial={t}
            saving={pending}
            saveLabel="Save ticket"
            onCancel={() => setEditingId(null)}
            onSave={(draft) => void run(() => onUpdate(t.id, draft))}
          />
        ) : (
          <TicketCard
            key={t.id}
            ticket={t}
            canEdit={isMember}
            pending={pending}
            onEdit={() => {
              setAdding(false);
              setError(null);
              setEditingId(t.id);
            }}
            onDelete={() => void run(() => onDelete(t.id))}
          />
        )
      )}

      {isMember && !adding && (
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setError(null);
            setAdding(true);
          }}
          className="rounded-lg border border-dashed border-rail/50 px-4 py-2 text-sm font-semibold text-rail transition-colors hover:bg-sky print:hidden"
        >
          + Add ticket
        </button>
      )}

      {adding && (
        <TicketForm
          initial={null}
          saving={pending}
          saveLabel="Add ticket"
          onCancel={() => setAdding(false)}
          onSave={(draft) => void run(() => onAdd(draft))}
        />
      )}

      {error && <p className="text-xs text-seal">{error}</p>}
    </div>
  );
}

function TicketCard({
  ticket,
  canEdit,
  pending,
  onEdit,
  onDelete,
}: {
  ticket: Ticket;
  canEdit: boolean;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = ticketKindMeta(ticket.kind);
  const route = [ticket.from, ticket.to].filter(Boolean).join(" → ");
  const dateLabel = ticket.date
    ? ticket.endDate && ticket.endDate !== ticket.date
      ? `${ticket.date} → ${ticket.endDate}`
      : ticket.date
    : "Date TBC";

  return (
    <article className="overflow-hidden rounded-xl border border-sky bg-paper shadow-sm">
      <div className="flex items-stretch">
        <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 bg-rail-deep py-4 text-white">
          <span aria-hidden className="text-xl">
            {meta.emoji}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest">{meta.label}</span>
        </div>
        <div className="min-w-0 flex-1 border-l-2 border-dashed border-sky px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="font-display text-base font-bold">{ticket.title}</p>
            <p className="font-mono text-xs text-rail">
              {dateLabel}
              {ticket.time && ` · ${ticket.time}`}
            </p>
          </div>
          {route && <p className="mt-0.5 font-mono text-sm tracking-wide text-ink-soft">{route}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
            {ticket.confirmation && (
              <span>
                Conf. <span className="font-mono font-semibold text-ink">{ticket.confirmation}</span>
              </span>
            )}
            {ticket.price && <span>💰 {ticket.price}</span>}
            <span className="ml-auto">added by {ticket.addedBy}</span>
          </div>
          {ticket.notes && <p className="mt-1.5 text-xs text-ink-soft">{ticket.notes}</p>}
          {canEdit && (
            <div className="mt-2 flex gap-2 print:hidden">
              <button
                type="button"
                disabled={pending}
                onClick={onEdit}
                className="rounded px-2 py-0.5 text-xs font-semibold text-rail transition-colors hover:bg-sky disabled:opacity-40"
              >
                ✎ Edit
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onDelete}
                className="rounded px-2 py-0.5 text-xs font-semibold text-seal transition-colors hover:bg-sky disabled:opacity-40"
              >
                ✕ Remove
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

interface FormFields {
  kind: TicketKind;
  title: string;
  date: string;
  endDate: string;
  time: string;
  from: string;
  to: string;
  confirmation: string;
  price: string;
  notes: string;
}

function toFields(t: Ticket | null): FormFields {
  return {
    kind: t?.kind ?? "train",
    title: t?.title ?? "",
    date: t?.date ?? "",
    endDate: t?.endDate ?? "",
    time: t?.time ?? "",
    from: t?.from ?? "",
    to: t?.to ?? "",
    confirmation: t?.confirmation ?? "",
    price: t?.price ?? "",
    notes: t?.notes ?? "",
  };
}

function toDraft(f: FormFields): TicketDraft {
  const clean = (v: string) => (v.trim() ? v.trim() : null);
  return {
    kind: f.kind,
    title: f.title.trim(),
    date: clean(f.date),
    endDate: clean(f.endDate),
    time: clean(f.time),
    from: clean(f.from),
    to: clean(f.to),
    confirmation: clean(f.confirmation),
    price: clean(f.price),
    notes: clean(f.notes),
  };
}

function TicketForm({
  initial,
  saving,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: Ticket | null;
  saving: boolean;
  saveLabel: string;
  onSave: (draft: TicketDraft) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<FormFields>(() => toFields(initial));
  const set = (patch: Partial<FormFields>) => setFields((f) => ({ ...f, ...patch }));
  const canSave = fields.title.trim().length > 0 && !saving;
  const input =
    "mt-1 w-full rounded-lg border border-sky bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail";
  const label = "text-xs font-medium text-ink-soft";

  return (
    <div className="rounded-xl border border-rail/40 bg-mist p-4 print:hidden">
      <div className="flex flex-wrap gap-2">
        {TICKET_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => set({ kind: k.id })}
            aria-pressed={fields.kind === k.id}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              fields.kind === k.id ? "bg-rail text-white" : "bg-paper text-ink-soft hover:bg-sky"
            }`}
          >
            {k.emoji} {k.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          Title
          <input
            type="text"
            value={fields.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder={fields.kind === "hotel" ? "Hotel name" : "e.g. G2 · CA1858 · Disneyland"}
            maxLength={80}
            autoFocus
            className={input}
          />
        </label>
        <label className={label}>
          {fields.kind === "hotel" ? "Check-in" : "Date"}
          <input type="date" value={fields.date} onChange={(e) => set({ date: e.target.value })} className={input} />
        </label>
        <label className={label}>
          {fields.kind === "hotel" ? "Check-out" : "End date (optional)"}
          <input type="date" value={fields.endDate} onChange={(e) => set({ endDate: e.target.value })} className={input} />
        </label>
        <label className={label}>
          Time
          <input type="text" value={fields.time} onChange={(e) => set({ time: e.target.value })} placeholder="08:05" maxLength={20} className={`${input} font-mono`} />
        </label>
        <label className={label}>
          Confirmation #
          <input type="text" value={fields.confirmation} onChange={(e) => set({ confirmation: e.target.value })} maxLength={60} className={`${input} font-mono`} />
        </label>
        <label className={label}>
          From
          <input type="text" value={fields.from} onChange={(e) => set({ from: e.target.value })} placeholder="Beijing" maxLength={60} className={input} />
        </label>
        <label className={label}>
          To
          <input type="text" value={fields.to} onChange={(e) => set({ to: e.target.value })} placeholder="Shanghai" maxLength={60} className={input} />
        </label>
        <label className={label}>
          Price
          <input type="text" value={fields.price} onChange={(e) => set({ price: e.target.value })} placeholder="¥553" maxLength={30} className={input} />
        </label>
        <label className={`${label} sm:col-span-2`}>
          Notes
          <input type="text" value={fields.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Seat 05A, carriage 3…" maxLength={300} className={input} />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave(toDraft(fields))}
          className="rounded-lg bg-rail px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-40"
        >
          {saving ? "Saving…" : saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-sky px-5 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-sky"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
