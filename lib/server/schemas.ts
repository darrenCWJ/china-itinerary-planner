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

const CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "ISO alpha-2 country code");

export const TripInputSchema = z.object({
  destinationIds: z.array(z.string().min(1).max(60)).min(1).max(8),
  days: z.number().int().min(1).max(21),
  season: SeasonSchema,
  adults: z.number().int().min(1).max(12),
  kids: z.number().int().min(0).max(12),
  interests: z.array(InterestSchema).max(11),
  // Optional in, guaranteed out. Country arrives on the next natural write of
  // each trip rather than through a bulk rewrite: updateTripData carries no
  // version guard, so a migration pass could clobber a concurrent member edit.
  country: CountryCodeSchema.default("CN"),
});

const MemberNameSchema = z.string().trim().min(1).max(30);

export const CreateTripSchema = z.object({
  tripName: z.string().trim().min(1).max(60),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  input: TripInputSchema,
  /**
   * The month the traveller picked, 1–12 (spec §5.2). Optional because clients
   * predating it send only `input.season`, which they derive with a northern-
   * hemisphere table. When the month is present the server derives the season
   * from it through the country profile and ignores what it was told — see
   * lib/tripSeason.ts.
   */
  month: z.number().int().min(1).max(12).optional(),
});

export const JoinTripSchema = z.object({
  code: z.string().trim().min(1).max(12),
  claimName: z.string().trim().min(1).max(30).optional(),
});

export const UpdateTripSchema = z.object({
  tripName: z.string().trim().min(1).max(60).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  input: TripInputSchema.optional(),
});

export const ToggleCheckSchema = z.object({
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
// Minutes from midnight, so a day is the natural bound: 1439 is 23:59, the last
// minute a block can start on. A duration of 0 is not a block, and nothing
// longer than 24h belongs on a single day.
const StartMinutesSchema = z.number().int().min(0).max(1439);
const DurationMinutesSchema = z.number().int().min(1).max(1440);

export const PlanOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("addItem"),
    day: DayNumberSchema,
    title: ItemTitleSchema,
    slot: TimeSlotSchema,
    time: ItemTimeSchema.optional(),
    note: ItemNoteSchema.optional(),
    // Not nullable: a brand-new item has no block to clear.
    startMinutes: StartMinutesSchema.optional(),
    durationMinutes: DurationMinutesSchema.optional(),
  }),
  z.object({
    op: z.literal("updateItem"),
    day: DayNumberSchema,
    itemId: ItemIdSchema,
    title: ItemTitleSchema.optional(),
    slot: TimeSlotSchema.optional(),
    time: ItemTimeSchema.nullable().optional(),
    note: ItemNoteSchema.nullable().optional(),
    startMinutes: StartMinutesSchema.nullable().optional(),
    durationMinutes: DurationMinutesSchema.nullable().optional(),
  }),
  z.object({
    op: z.literal("setTiming"),
    day: DayNumberSchema,
    itemId: ItemIdSchema,
    // Both required, so a block is always set or cleared as a whole and a half
    // a block can never reach storage.
    startMinutes: StartMinutesSchema.nullable(),
    durationMinutes: DurationMinutesSchema.nullable(),
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
  ticket: TicketFieldsSchema,
});

export const UpdateTicketSchema = z.object({
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
  expense: ExpenseFieldsSchema,
});

export const UpdateExpenseSchema = z.object({
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
  entry: JournalFieldsSchema,
});

export const UpdateJournalSchema = z.object({
  entry: JournalFieldsSchema.partial(),
});

export const CurrencySettingsSchema = z.object({
  home: CurrencyCodeSchema.nullable(),
  // Key schema is deliberately transform-free: record keys must stay plain
  // strings, so validate the shape and let the client send uppercase.
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().finite()),
  // Listed explicitly because unknown keys are stripped: without this the
  // route would accept a pivot, drop it, and store rates whose meaning no
  // longer matches what the client sent.
  pivot: CurrencyCodeSchema.optional(),
});

/**
 * Everything a user can choose about the accent is a hue, never a colour.
 * Lightness and chroma stay pinned in lib/accent, so the whole validation
 * burden for a user-supplied accent is a bounded integer — no string, no
 * escaping question, nothing that could reach a stylesheet as syntax.
 */
const HueSchema = z.number().int().min(0).max(359);

export const PrefsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("light"),
  accent: z.union([z.literal("country"), HueSchema]).default("country"),
  accentHues: z.record(z.string().regex(/^[A-Z]{2}$/), HueSchema).default({}),
});
