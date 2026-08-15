import { z } from "zod";

export const SeasonSchema = z.enum(["spring", "summer", "autumn", "winter"]);

export const InterestSchema = z.enum([
  "food",
  "history",
  "nature",
  "beach",
  "themepark",
  "arcade",
  "shopping",
  "nightlife",
  "museums",
  "hiking",
  "family",
]);

export const TripInputSchema = z.object({
  destinationIds: z.array(z.string().min(1).max(60)).min(1).max(8),
  days: z.number().int().min(1).max(21),
  season: SeasonSchema,
  adults: z.number().int().min(1).max(12),
  kids: z.number().int().min(0).max(12),
  interests: z.array(InterestSchema).max(11),
});

const MemberNameSchema = z.string().trim().min(1).max(30);

export const CreateTripSchema = z.object({
  tripName: z.string().trim().min(1).max(60),
  creatorName: MemberNameSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  input: TripInputSchema,
});

export const JoinTripSchema = z.object({
  code: z.string().trim().min(1).max(12),
  claimName: z.string().trim().min(1).max(30).optional(),
});

export const UpdateTripSchema = z.object({
  memberName: MemberNameSchema,
  tripName: z.string().trim().min(1).max(60).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  input: TripInputSchema.optional(),
});

export const ToggleCheckSchema = z.object({
  memberName: MemberNameSchema,
  key: z.string().min(1).max(200),
  checked: z.boolean(),
});

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TimeSlotSchema = z.enum(["morning", "afternoon", "evening"]);
const DayNumberSchema = z.number().int().min(1).max(60);
const ItemIdSchema = z.string().min(1).max(60);
const ItemTitleSchema = z.string().trim().min(1).max(80);
const ItemTimeSchema = z.string().trim().max(20);
const ItemNoteSchema = z.string().trim().max(200);

export const PlanOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("addItem"),
    day: DayNumberSchema,
    title: ItemTitleSchema,
    slot: TimeSlotSchema,
    time: ItemTimeSchema.optional(),
    note: ItemNoteSchema.optional(),
  }),
  z.object({
    op: z.literal("updateItem"),
    day: DayNumberSchema,
    itemId: ItemIdSchema,
    title: ItemTitleSchema.optional(),
    slot: TimeSlotSchema.optional(),
    time: ItemTimeSchema.nullable().optional(),
    note: ItemNoteSchema.nullable().optional(),
  }),
  z.object({ op: z.literal("removeItem"), day: DayNumberSchema, itemId: ItemIdSchema }),
  z.object({
    op: z.literal("moveItem"),
    day: DayNumberSchema,
    itemId: ItemIdSchema,
    direction: z.enum(["up", "down"]),
  }),
  z.object({ op: z.literal("addDay"), destinationId: z.string().min(1).max(60).optional() }),
]);

export const PlanEditSchema = z.object({
  memberName: MemberNameSchema,
  op: PlanOpSchema,
});

export const TicketKindSchema = z.enum(["flight", "train", "hotel", "attraction", "other"]);

export const TicketFieldsSchema = z.object({
  kind: TicketKindSchema,
  title: z.string().trim().min(1).max(80),
  date: IsoDateSchema.nullable().optional(),
  endDate: IsoDateSchema.nullable().optional(),
  time: z.string().trim().max(20).nullable().optional(),
  from: z.string().trim().max(60).nullable().optional(),
  to: z.string().trim().max(60).nullable().optional(),
  confirmation: z.string().trim().max(60).nullable().optional(),
  price: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const AddTicketSchema = z.object({
  memberName: MemberNameSchema,
  ticket: TicketFieldsSchema,
});

export const UpdateTicketSchema = z.object({
  memberName: MemberNameSchema,
  ticket: TicketFieldsSchema.partial(),
});

export const MyTripSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(60),
  startDate: IsoDateSchema.nullable(),
  days: z.number().int().min(1).max(60),
  destinations: z.array(z.string().min(1).max(80)).max(10),
  role: z.enum(["creator", "member"]),
  memberName: MemberNameSchema.optional(),
  savedAt: z.number(),
});

const WalletTripsSchema = z.array(MyTripSchema).max(20);
const WalletCodeSchema = z.string().trim().min(6).max(20);

export const WalletCreateSchema = z.object({ trips: WalletTripsSchema });
export const WalletFetchSchema = z.object({ code: WalletCodeSchema });
export const WalletPutSchema = z.object({
  code: WalletCodeSchema,
  trips: WalletTripsSchema,
  baseVersion: z.number().int().min(1),
});

export const BriefingShareSchema = z.object({
  memberName: MemberNameSchema,
  enabled: z.boolean(),
  includeBookings: z.boolean(),
});

const CurrencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "3-letter currency code");
const MinorAmountSchema = z.number().int().min(1).max(100_000_000);

export const ExpenseCategorySchema = z.enum([
  "food",
  "transport",
  "lodging",
  "tickets",
  "shopping",
  "other",
]);

export const ExpenseFieldsSchema = z.object({
  date: IsoDateSchema,
  title: z.string().trim().min(1).max(80),
  category: ExpenseCategorySchema,
  amount: MinorAmountSchema,
  currency: CurrencyCodeSchema,
  paidBy: MemberNameSchema,
  splitAmong: z.array(MemberNameSchema).max(20),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const AddExpenseSchema = z.object({
  memberName: MemberNameSchema,
  expense: ExpenseFieldsSchema,
});

export const UpdateExpenseSchema = z.object({
  memberName: MemberNameSchema,
  expense: ExpenseFieldsSchema.partial(),
});

export const SettlementFieldsSchema = z.object({
  date: IsoDateSchema,
  from: MemberNameSchema,
  to: MemberNameSchema,
  amount: MinorAmountSchema,
  currency: CurrencyCodeSchema,
});

export const AddSettlementSchema = z.object({
  memberName: MemberNameSchema,
  settlement: SettlementFieldsSchema,
});

/** Upload refs are exact stored filenames — no dots or slashes beyond one extension. */
export const PHOTO_REF_RE = /^[a-z0-9-]{8,60}\.(jpg|png|webp)$/;

export const JournalPhotoSchema = z.union([
  z.object({ kind: z.literal("upload"), ref: z.string().regex(PHOTO_REF_RE) }),
  z.object({
    kind: z.literal("link"),
    ref: z.string().max(500).regex(/^https:\/\/\S+$/, "https URL"),
  }),
]);

export const JournalFieldsSchema = z.object({
  date: IsoDateSchema,
  text: z.string().trim().min(1).max(5000),
  photos: z.array(JournalPhotoSchema).max(12),
});

export const AddJournalSchema = z.object({
  memberName: MemberNameSchema,
  entry: JournalFieldsSchema,
});

export const UpdateJournalSchema = z.object({
  memberName: MemberNameSchema,
  entry: JournalFieldsSchema.partial(),
});

export const CurrencySettingsSchema = z.object({
  memberName: MemberNameSchema,
  home: CurrencyCodeSchema.nullable(),
  // Key schema is deliberately transform-free: record keys must stay plain
  // strings, so validate the shape and let the client send uppercase.
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().finite()),
});
