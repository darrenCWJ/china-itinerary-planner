import type { Metadata } from "next";
import { UnlockForm } from "@/components/UnlockForm";

export const metadata: Metadata = {
  title: "Enter access code — China Itinerary Planner",
};

export default function UnlockPage() {
  return <UnlockForm />;
}
