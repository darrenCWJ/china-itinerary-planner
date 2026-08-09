import type { Metadata } from "next";
import { TripView } from "@/components/TripView";

export const metadata: Metadata = {
  title: "Shared trip — China Itinerary Planner",
};

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripView tripId={id} />;
}
