import { DEFAULT_COUNTRY, getCountryProfile } from "./countryProfile";
import type { TripInput } from "./itinerary";
import type { Destination, PackingGroup, Season } from "./types";

/**
 * Declared in lib/types.ts so lib/countryProfile.ts can name the shape without
 * importing this module. Re-exported here under the name it has always had, so
 * no consumer's import path changes.
 */
export type { PackingGroup };

const CLOTHING_BY_SEASON: Record<Season, string[]> = {
  spring: [
    "Light layers plus a warm jacket for evenings",
    "Compact umbrella or rain jacket",
    "Comfortable broken-in walking shoes",
  ],
  summer: [
    "Breathable, quick-dry clothing",
    "Sun hat and sunglasses",
    "High-SPF sunscreen",
    "Compact umbrella (doubles for sun and sudden downpours)",
    "Comfortable broken-in walking shoes",
  ],
  autumn: [
    "Layers: t-shirts plus a fleece or light down jacket",
    "Light scarf for cool evenings",
    "Comfortable broken-in walking shoes",
  ],
  // Cold-weather items that hold anywhere it is cold. The country's own winter
  // line — China's is about northern China's dry air — is appended from the
  // profile below, so a southern coastal winter is not told the air is dry.
  winter: ["Thermal base layers", "Insulated coat, gloves, scarf and beanie", "Warm waterproof shoes"],
};

const BEACH_DESTINATIONS = new Set(["sanya", "xiamen", "qingdao", "shenzhen"]);

export function buildPackingList(input: TripInput, destinations: Destination[]): PackingGroup[] {
  // Same seam as buildItinerary, read the same way, so one TripInput can never
  // produce a plan for one country and a packing list for another.
  const profile = getCountryProfile(input.country ?? DEFAULT_COUNTRY);

  const clothingItems = [...CLOTHING_BY_SEASON[input.season]];
  if (input.season === "winter" && profile.copy.winterClothingNote) {
    clothingItems.push(profile.copy.winterClothingNote);
  }
  if (input.season === "winter" && destinations.some((d) => d.id === "harbin")) {
    clothingItems.push(
      "Harbin extreme-cold kit: -20°C rated coat, hand warmers and snow boots"
    );
  }

  const groups: PackingGroup[] = [
    // Already fresh objects with copied arrays — getCountryProfile's contract —
    // so the caller owns what it is handed and the curated document behind it
    // cannot be corrupted by a caller that edits its own list.
    ...profile.packing,
    {
      title: `Clothing for ${input.season}`,
      emoji: "🧥",
      items: clothingItems,
    },
  ];

  const gear: string[] = [];
  const hasBeach =
    input.interests.includes("beach") || destinations.some((d) => BEACH_DESTINATIONS.has(d.id));
  if (hasBeach) {
    gear.push("Swimwear and flip-flops", "Waterproof phone pouch", "After-sun lotion");
  }
  if (input.interests.includes("hiking")) {
    gear.push("Hiking shoes with grip", "Small daypack", "Blister plasters");
  }
  if (input.interests.includes("themepark")) {
    gear.push("Extra-comfy shoes for queue days", "Portable phone fan for summer queues");
  }
  if (gear.length > 0) {
    groups.push({ title: "Activity Gear", emoji: "🎒", items: gear });
  }

  if (input.kids > 0) {
    groups.push({
      title: "Travelling with Kids",
      emoji: "🧸",
      items: [
        "Snacks and entertainment for long train rides",
        "Stroller or carrier — expect stairs at older attractions",
        "Copies of kids' passports kept separately",
        "Wet wipes (endlessly useful)",
      ],
    });
  }

  return groups;
}
