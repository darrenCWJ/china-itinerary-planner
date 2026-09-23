import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/shell/AppShell";
import { ShellTripProvider } from "@/components/shell/ShellTripContext";
import { TripAccentProvider } from "@/components/shell/TripAccentProvider";
import "./fonts/fonts.css";
import "./globals.css";

/*
 * The three families, vendored under app/fonts/ rather than fetched from
 * Google at build time (vercel/next.js#99114; app/fonts/fonts.css has the
 * story and the provenance).
 *
 * Each call owns only its family's LATIN files, the ones next/font preloads, as
 * `subsets: ["latin"]` used to. The other subsets are in fonts.css under the
 * family's real name, and `fallback` chains to them, then to the metric-matched
 * Arial defined there. So `adjustFontFallback` is off: next/font's own fallback
 * would land between the two and catch ł before the latin-ext face was asked.
 *
 * The descriptors copy Google's CSS for these faces: one face per weight, each
 * pointing at the same file for the two variable families, font-stretch: 100%
 * on those two, and the latin unicode-range. next/font needs literal options,
 * so the range is written out three times. Turbopack names each family after
 * its const.
 */
const bricolageLatin = localFont({
  src: [
    { path: "./fonts/bricolage-grotesque/bricolage-grotesque-latin.woff2", weight: "600" },
    { path: "./fonts/bricolage-grotesque/bricolage-grotesque-latin.woff2", weight: "700" },
    { path: "./fonts/bricolage-grotesque/bricolage-grotesque-latin.woff2", weight: "800" },
  ],
  style: "normal",
  display: "swap",
  variable: "--font-brico",
  adjustFontFallback: false,
  fallback: ["'Bricolage Grotesque'", "'Bricolage Grotesque Fallback'"],
  declarations: [
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const plexSansLatin = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-sans/ibm-plex-sans-latin.woff2", weight: "600" },
  ],
  style: "normal",
  display: "swap",
  variable: "--font-plex",
  adjustFontFallback: false,
  fallback: ["'IBM Plex Sans'", "'IBM Plex Sans Fallback'"],
  declarations: [
    { prop: "font-stretch", value: "100%" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const plexMonoLatin = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-500-latin.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono/ibm-plex-mono-600-latin.woff2", weight: "600" },
  ],
  style: "normal",
  display: "swap",
  variable: "--font-plexmono",
  adjustFontFallback: false,
  fallback: ["'IBM Plex Mono'", "'IBM Plex Mono Fallback'"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

export const metadata: Metadata = {
  title: "Itinerary Planner",
  description:
    "Plan a trip in three steps — pick destinations, tune the details, get a day-by-day plan with a packing list.",
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
      className={`${bricolageLatin.variable} ${plexSansLatin.variable} ${plexMonoLatin.variable}`}
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
