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

/** A gateway airport, as the IATA code data/airports.json keys on. */
const IataSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "3-letter IATA airport code");

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
  // Listed explicitly because unknown keys are stripped: without these two the
  // create route would accept a gateway, drop it, and stamp its own guess in
  // its place. Optional AND nullable — absent, null and a code are three
  // states (spec §10.3), and the create route fills only the first.
  arrivalAirport: IataSchema.nullable().optional(),
  departureAirport: IataSchema.nullable().optional(),
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

const PlanOpVariants = z.discriminatedUnion("op", [
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
    /**
     * Both keys are required — omitting either fails parse. Whether they may
     * *disagree* in nullness is enforced below, not here: this comment used to
     * claim the pair could never split, and that was false. Independently
     * `.nullable()` fields accepted `{ startMinutes: 540, durationMinutes: null }`,
     * which stored a start with no duration; every reader treats that as untimed
     * (`lib/timeline.ts`'s both-halves test, `dayLoad`), so the member's block
     * silently vanished and counted zero minutes. A lost edit with no error.
     */
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

/**
 * A timing pair is set or cleared as a whole — never half, on any op that can
 * carry one.
 *
 * Originally guarded `setTiming` alone, which left the other two doors open:
 * `addItem` stores whatever it is given, so `{ startMinutes: 540 }` created a
 * half pair directly, and `updateItem` accepted one half against an explicit
 * clear of the other. Same consequence each time, described below.
 *
 * The two fields are independently `.nullable()`, so the union alone accepted a
 * start with a null duration. Nothing downstream treats that as a block:
 * `lib/timeline.ts` requires both halves, so the item reads as untimed, renders
 * outside the timeline and contributes zero to the day-load readout. The write
 * succeeded and the edit was gone. Enforced here rather than by widening the
 * field types, because both keys really are required and only their agreement
 * needed a rule.
 */
function splitsTimingPair(op: z.infer<typeof PlanOpVariants>): boolean {
  switch (op.op) {
    case "setTiming":
      // Both keys required, either may be null: a split is disagreeing nullness.
      return (op.startMinutes === null) !== (op.durationMinutes === null);
    case "addItem":
      // Optional and never nullable, and the reducer copies both straight onto
      // the new item — so exactly one present is exactly one stored.
      return (op.startMinutes === undefined) !== (op.durationMinutes === undefined);
    case "updateItem":
      // `undefined` means "leave alone", so whether the *result* is half depends
      // on the stored item, which a schema cannot see. Only one half set against
      // the other explicitly cleared is unambiguous here; the state-dependent
      // case is enforced in planOps.ts, where the existing item is in hand.
      return (
        (typeof op.startMinutes === "number" && op.durationMinutes === null) ||
        (typeof op.durationMinutes === "number" && op.startMinutes === null)
      );
    default:
      return false;
  }
}

export const PlanOpSchema = PlanOpVariants.superRefine((op, ctx) => {
  if (!splitsTimingPair(op)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["durationMinutes"],
    message: "startMinutes and durationMinutes must be set or cleared together",
  });
});

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
 * PUT /api/trips/:id/gateways. Both keys required — null clears, a code sets —
 * so a save can never half-apply and leave one side stale.
 */
export const GatewaysSchema = z.object({
  arrivalAirport: IataSchema.nullable(),
  departureAirport: IataSchema.nullable(),
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
  // Listed explicitly because unknown keys are stripped by default: without
  // this, a saved worldView choice would round-trip through the cookie but be
  // silently discarded on every cross-device sync through this route.
  worldView: z.enum(["globe", "flat"]).default("globe"),
});
