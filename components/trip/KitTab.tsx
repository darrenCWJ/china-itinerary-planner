"use client";

import type { PackingGroup } from "@/lib/packing";
import type { Ticket } from "@/lib/tripShared";
import { PackingSection } from "./PackingSection";
import { TicketsTab, type TicketDraft } from "./TicketsTab";

/**
 * Kit: bookings above bag (spec §2.1).
 *
 * The two are one tab because both are things you carry, both are checkable, and
 * both matter at the same two moments — the night before, and at the barrier.
 * Each keeps its own heading rather than being interleaved, because "what have I
 * booked" and "what have I packed" are still separate questions asked in
 * sequence.
 *
 * Purely compositional: props are the union of the two children's, and neither
 * child is modified. Not wired into TripView until Task 12.
 */
interface Props {
  // Bookings
  tickets: Ticket[];
  hasStartDate: boolean;
  onAddTicket(draft: TicketDraft): Promise<string | null>;
  onUpdateTicket(ticketId: string, draft: TicketDraft): Promise<string | null>;
  onDeleteTicket(ticketId: string): Promise<string | null>;
  // Bag
  packing: PackingGroup[];
  checkedBy: Map<string, string>;
  onToggleCheck(key: string, checked: boolean): void;
  // Shared
  isMember: boolean;
}

export function KitTab({
  tickets,
  hasStartDate,
  onAddTicket,
  onUpdateTicket,
  onDeleteTicket,
  packing,
  checkedBy,
  onToggleCheck,
  isMember,
}: Props) {
  return (
    <div className="mt-5 space-y-8">
      <section aria-labelledby="kit-bookings">
        <h2 id="kit-bookings" className="font-display text-lg font-semibold">
          Bookings
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Tickets, trains and stays — everything with a confirmation number.
        </p>
        {/* TicketsTab renders its own top margin, so no wrapper spacing here. */}
        <TicketsTab
          tickets={tickets}
          isMember={isMember}
          hasStartDate={hasStartDate}
          onAdd={onAddTicket}
          onUpdate={onUpdateTicket}
          onDelete={onDeleteTicket}
        />
      </section>

      <section aria-labelledby="kit-bag">
        <h2 id="kit-bag" className="font-display text-lg font-semibold">
          Your bag
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Tick items off as you pack. Everyone sees who packed what.
        </p>
        <PackingSection
          packing={packing}
          checkedBy={checkedBy}
          isMember={isMember}
          onToggle={onToggleCheck}
        />
      </section>
    </div>
  );
}
