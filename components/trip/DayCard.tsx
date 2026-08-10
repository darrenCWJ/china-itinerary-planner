"use client";

import { useState } from "react";
import type { DayPlan, ScheduledItem } from "@/lib/itinerary";
import { KIND_EMOJI, SLOT_META, ticketKindMeta } from "@/lib/meta";
import type { PlanOp } from "@/lib/planOps";
import { itemCheckKey, type Ticket } from "@/lib/tripShared";
import type { TimeSlot } from "@/lib/types";

interface ItemFields {
  title: string;
  slot: TimeSlot;
  time: string;
  note: string;
}

interface DayCardProps {
  day: DayPlan;
  isToday: boolean;
  /** Tickets that fall on this day's date, already sorted. */
  tickets: Ticket[];
  checkedBy: Map<string, string>;
  isMember: boolean;
  onToggle: (key: string, checked: boolean) => void;
  /** Sends one plan edit; resolves to an error message or null. */
  onOp: (op: PlanOp) => Promise<string | null>;
}

export function DayCard({ day, isToday, tickets, checkedBy, isMember, onToggle, onOp }: DayCardProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (op: PlanOp, closeForms = false) => {
    if (pending) return;
    setPending(true);
    setError(null);
    const err = await onOp(op);
    setPending(false);
    if (err) {
      setError(err);
    } else if (closeForms) {
      setAdding(false);
      setEditingId(null);
    }
  };

  return (
    <article
      className={`rounded-xl border bg-paper shadow-sm ${isToday ? "border-seal" : "border-sky"}`}
    >
      <header className="flex items-baseline justify-between px-5 pt-4">
        <p className="font-mono text-sm font-semibold uppercase tracking-widest text-rail">
          Day {String(day.day).padStart(2, "0")}
          {isToday && (
            <span className="ml-2 rounded bg-seal px-1.5 py-0.5 text-[10px] text-white">TODAY</span>
          )}
        </p>
        <p className="text-sm font-medium text-ink-soft">{day.destinationName}</p>
      </header>

      {tickets.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 pt-2">
          {tickets.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-rail/50 bg-mist px-2 py-1 font-mono text-[11px] text-rail-deep"
            >
              <span aria-hidden>{ticketKindMeta(t.kind).emoji}</span>
              {t.time && <span>{t.time}</span>}
              <span className="font-semibold">{t.title}</span>
            </span>
          ))}
        </div>
      )}

      <div className="relative mx-5 mt-3 border-t-2 border-dashed border-sky">
        <span aria-hidden className="absolute -left-[30px] -top-2 h-4 w-4 rounded-full bg-mist" />
        <span aria-hidden className="absolute -right-[30px] -top-2 h-4 w-4 rounded-full bg-mist" />
      </div>

      <ul className="space-y-3 px-5 py-4">
        {day.items.map((item, idx) =>
          editingId === item.id ? (
            <li key={item.id}>
              <ItemForm
                initial={{
                  title: item.title,
                  slot: item.slot,
                  time: item.time ?? "",
                  note: item.note ?? "",
                }}
                saving={pending}
                saveLabel="Save"
                onCancel={() => setEditingId(null)}
                onSave={(f) =>
                  void run(
                    {
                      op: "updateItem",
                      day: day.day,
                      itemId: item.id,
                      title: f.title,
                      slot: f.slot,
                      time: f.time.trim() || null,
                      note: f.note.trim() || null,
                    },
                    true
                  )
                }
              />
            </li>
          ) : (
            <ItemRow
              key={item.id}
              item={item}
              checkedBy={checkedBy}
              canCheck={isMember}
              onToggle={onToggle}
              controls={
                isMember ? (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 print:hidden">
                    <IconButton
                      label={`Move "${item.title}" up`}
                      disabled={pending || idx === 0}
                      onClick={() =>
                        void run({ op: "moveItem", day: day.day, itemId: item.id, direction: "up" })
                      }
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      label={`Move "${item.title}" down`}
                      disabled={pending || idx === day.items.length - 1}
                      onClick={() =>
                        void run({ op: "moveItem", day: day.day, itemId: item.id, direction: "down" })
                      }
                    >
                      ↓
                    </IconButton>
                    <IconButton
                      label={`Edit "${item.title}"`}
                      disabled={pending}
                      onClick={() => {
                        setAdding(false);
                        setError(null);
                        setEditingId(item.id);
                      }}
                    >
                      ✎
                    </IconButton>
                    <IconButton
                      label={`Remove "${item.title}"`}
                      disabled={pending}
                      onClick={() => void run({ op: "removeItem", day: day.day, itemId: item.id })}
                    >
                      ✕
                    </IconButton>
                  </span>
                ) : null
              }
            />
          )
        )}

        {isMember && !adding && (
          <li className="print:hidden">
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setError(null);
                setAdding(true);
              }}
              className="rounded-lg border border-dashed border-rail/50 px-3 py-1.5 text-xs font-semibold text-rail transition-colors hover:bg-sky"
            >
              + Add item
            </button>
          </li>
        )}

        {adding && (
          <li className="print:hidden">
            <ItemForm
              initial={{ title: "", slot: "morning", time: "", note: "" }}
              saving={pending}
              saveLabel="Add"
              onCancel={() => setAdding(false)}
              onSave={(f) =>
                void run(
                  {
                    op: "addItem",
                    day: day.day,
                    title: f.title,
                    slot: f.slot,
                    time: f.time.trim() || undefined,
                    note: f.note.trim() || undefined,
                  },
                  true
                )
              }
            />
          </li>
        )}

        {error && <li className="text-xs text-seal">{error}</li>}
      </ul>
    </article>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-6 w-6 rounded text-xs text-ink-soft transition-colors hover:bg-sky hover:text-rail-deep disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ItemForm({
  initial,
  saving,
  saveLabel,
  onSave,
  onCancel,
}: {
  initial: ItemFields;
  saving: boolean;
  saveLabel: string;
  onSave: (fields: ItemFields) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<ItemFields>(initial);
  const set = (patch: Partial<ItemFields>) => setFields((f) => ({ ...f, ...patch }));
  const canSave = fields.title.trim().length > 0 && !saving;

  return (
    <div className="rounded-lg border border-sky bg-mist p-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={fields.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="What are you doing?"
          maxLength={80}
          autoFocus
          className="min-w-40 flex-1 rounded-lg border border-sky bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
        />
        <select
          value={fields.slot}
          onChange={(e) => set({ slot: e.target.value as TimeSlot })}
          aria-label="Time of day"
          className="rounded-lg border border-sky bg-paper px-2 py-1.5 text-sm text-ink"
        >
          <option value="morning">🌅 Morning</option>
          <option value="afternoon">☀️ Afternoon</option>
          <option value="evening">🌙 Evening</option>
        </select>
        <input
          type="text"
          value={fields.time}
          onChange={(e) => set({ time: e.target.value })}
          placeholder="Time (opt.)"
          maxLength={20}
          className="w-24 rounded-lg border border-sky bg-paper px-2 py-1.5 font-mono text-sm text-ink"
        />
      </div>
      <input
        type="text"
        value={fields.note}
        onChange={(e) => set({ note: e.target.value })}
        placeholder="Note (optional)"
        maxLength={200}
        className="mt-2 w-full rounded-lg border border-sky bg-paper px-3 py-1.5 text-xs text-ink"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave(fields)}
          className="rounded-lg bg-rail px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-40"
        >
          {saving ? "Saving…" : saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-sky px-4 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-sky"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  checkedBy,
  canCheck,
  onToggle,
  controls,
}: {
  item: ScheduledItem;
  checkedBy: Map<string, string>;
  canCheck: boolean;
  onToggle: (key: string, checked: boolean) => void;
  controls: React.ReactNode;
}) {
  const slot = SLOT_META[item.slot];
  const checkKey = itemCheckKey(item.id);
  const by = checkedBy.get(checkKey);
  const isCheckable = item.kind === "activity" || item.kind === "custom";
  const kindEmoji = KIND_EMOJI[item.kind];
  return (
    <li className="flex gap-3">
      <span className="w-24 shrink-0 pt-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        {slot.emoji} {item.fullDay ? "All day" : slot.label}
      </span>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {isCheckable && (
          <input
            type="checkbox"
            checked={by !== undefined}
            disabled={!canCheck}
            onChange={(e) => onToggle(checkKey, e.target.checked)}
            aria-label={`Mark "${item.title}" as done`}
            className="mt-0.5 h-4 w-4 accent-rail"
          />
        )}
        <div className="min-w-0">
          <p
            className={
              item.kind === "free"
                ? "text-sm italic text-ink-soft"
                : by
                  ? "text-sm font-medium text-ink-soft line-through"
                  : "text-sm font-medium"
            }
          >
            {kindEmoji && <span aria-hidden>{kindEmoji} </span>}
            {item.time && <span className="font-mono text-xs text-rail">{item.time} </span>}
            {item.title}
            {by && <span className="ml-1 text-[11px] text-rail"> · done by {by}</span>}
          </p>
          {item.note && <p className="mt-0.5 text-xs text-ink-soft">{item.note}</p>}
        </div>
        {controls}
      </div>
    </li>
  );
}
