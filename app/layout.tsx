import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { AppHeader } from "@/components/shell/AppHeader";
import { PrefsProvider } from "@/components/shell/PrefsProvider";
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
 * free of an injection surface. PR1 forces light regardless of what the cookie
 * says (the components below are light-only); the cookie read is present so
 * PR2's change is the one line that picks `t` out of the allowlist.
 */
const FIRST_PAINT = `(function(){try{
var m=document.cookie.match(/(?:^|; )cip-prefs=([^;]*)/);
var t="light";
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
      <body className="bg-mist font-sans text-ink antialiased">
        <PrefsProvider>
          <AppHeader />
          {children}
        </PrefsProvider>
      </body>
    </html>
  );
}
