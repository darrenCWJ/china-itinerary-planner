import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { ShellTripProvider } from "@/components/shell/ShellTripContext";
import { TripAccentProvider } from "@/components/shell/TripAccentProvider";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-brico",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-plexmono",
});

export const metadata: Metadata = {
  title: "China Itinerary Planner",
  description:
    "Plan a trip to China in three steps — pick destinations, tune the details, get a day-by-day plan with a packing list.",
};

/**
 * Runs synchronously while the browser parses the head, before first paint, so
 * the theme is correct rather than corrected — the mechanism Next documents in
 * "Preventing flash before hydration". Reading the cookie here rather than with
 * cookies() keeps the whole app statically prerenderable.
 *
 * A constant string with no interpolation of anything, which is what keeps it
 * free of an injection surface. The cookie is read but never trusted: `t` comes
 * out of a two-value allowlist, so anything that is not exactly `dark` or
 * `system` — a corrupted value, someone else's cookie, a hostile one — degrades
 * to light rather than reaching the DOM.
 */
const FIRST_PAINT = `(function(){try{
var m=document.cookie.match(/(?:^|; )cip-prefs=([^;]*)/);
var p=m?decodeURIComponent(m[1]):"";
var s=p.match(/(?:^|&)theme=([a-z]+)/);
var v=s?s[1]:"light";
var t=v==="dark"?"dark":v==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):"light";
document.documentElement.setAttribute("data-theme",t);
}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: FIRST_PAINT }} />
      </head>
      <body className="bg-[var(--surf-1)] font-sans text-[var(--ink-0)] antialiased">
        {/*
          ShellTripProvider is outermost so the accent bridge below can read the
          open trip. It sits above AppShell either way: the header reads the trip
          and the page publishes it, so the store has to be an ancestor of both.
          See ShellTripContext.

          TripAccentProvider then feeds that trip's country into PrefsProvider,
          which is what makes the per-country accent move at all — prefs used to
          be the outer provider and could not see the trip, so every trip
          rendered China's hue.
        */}
        <ShellTripProvider>
          <TripAccentProvider>
            <AppShell>{children}</AppShell>
          </TripAccentProvider>
        </ShellTripProvider>
      </body>
    </html>
  );
}
