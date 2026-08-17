"use client";

import type { TripTabId } from "@/lib/nav";
import type { TripPayload } from "@/lib/tripShared";
import type { JournalDraft } from "./JournalSection";
import { TrackerTab } from "./TrackerTab";

/**
 * Today (spec §2.1) — the surface formerly called Tracker, renamed without
 * touching its internals so Task 12's diff stays mechanical.
 *
 * The one real change: Tracker exposes `onOpenMoney: () => void`, which encodes
 * a destination in a prop name. Here it becomes `onOpenTab(tab)` over the nav's
 * own id union, so the tab vocabulary comes from `lib/nav` (C1) and a future
 * cross-link to Kit or Plan needs no new prop.
 */
interface Props {
  payload: TripPayload;
  myName: string;
  isMember: boolean;
  onToggle(key: string, checked: boolean): void;
  onAddJournal(draft: JournalDraft): Promise<string | null>;
  onUpdateJournal(id: string, draft: Partial<JournalDraft>): Promise<string | null>;
  onDeleteJournal(id: string): Promise<string | null>;
  onOpenTab(tab: TripTabId): void;
}

export function TodayTab({ onOpenTab, ...tracker }: Props) {
  return <TrackerTab {...tracker} onOpenMoney={() => onOpenTab("money")} />;
}
