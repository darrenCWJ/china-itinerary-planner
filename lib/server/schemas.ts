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
  name: MemberNameSchema,
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
