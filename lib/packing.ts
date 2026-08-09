import type { TripInput } from "./itinerary";
import type { Destination, Season } from "./types";

export interface PackingGroup {
  title: string;
  emoji: string;
  items: string[];
}

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
  winter: [
    "Thermal base layers",
    "Insulated coat, gloves, scarf and beanie",
    "Warm waterproof shoes",
    "Lip balm and moisturiser — northern air is very dry",
  ],
};

const BEACH_DESTINATIONS = new Set(["sanya", "xiamen", "qingdao", "shenzhen"]);

export function buildPackingList(input: TripInput, destinations: Destination[]): PackingGroup[] {
  const clothingItems = [...CLOTHING_BY_SEASON[input.season]];
  if (input.season === "winter" && destinations.some((d) => d.id === "harbin")) {
    clothingItems.push(
      "Harbin extreme-cold kit: -20°C rated coat, hand warmers and snow boots"
    );
  }

  const groups: PackingGroup[] = [
    {
      title: "Documents & Money",
      emoji: "🛂",
      items: [
        "Passport (6+ months validity) and visa or visa-free confirmation",
        "Printed hotel bookings and return flight (border control may ask)",
        "Alipay + WeChat Pay set up and tested with your bank card",
        "Some RMB cash (¥300–500) as a backup",
        "Travel insurance policy details",
      ],
    },
    {
      title: "Tech",
      emoji: "🔌",
      items: [
        "Phone + power bank — everything in China runs through your phone",
        "VPN installed and tested before departure",
        "Universal power adapter (China uses type A/C/I plugs, 220V)",
        "Offline translation app (Pleco or Google Translate offline pack)",
        "Offline maps app (Amap 高德 has the best China coverage)",
      ],
    },
    {
      title: "Health & Comfort",
      emoji: "💊",
      items: [
        "Prescription medicines in original packaging",
        "Pocket tissues and hand sanitiser — many restrooms lack paper",
        "Basic meds: stomach relief, cold tablets, motion sickness",
        "Reusable water bottle — hotels have kettles; tap water isn't potable",
      ],
    },
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
