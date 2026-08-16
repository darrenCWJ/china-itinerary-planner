"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import type { AccentTheme } from "@/lib/accent";
import {
  DEFAULT_PREFS,
  PREFS_COOKIE,
  parsePrefsCookie,
  resolveAccentVars,
  sanitizePrefs,
  serializePrefsCookie,
  type UserPrefs,
} from "@/lib/prefs";

/**
 * PR1 renders light and only light. The preference is read, stored and sent to
 * the server, but the attribute is pinned, because every component that exists
 * today is written against fixed light palette utilities — honouring a dark
 * preference now would restyle half the app and leave the other half white.
 * PR2 builds the shell that consumes the tokens and deletes this constant.
 */
const PINNED_THEME: AccentTheme = "light";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

interface PrefsContextValue {
  prefs: UserPrefs;
  setPrefs(next: UserPrefs): void;
}

/**
 * Defaults rather than undefined, so `usePrefs` outside a provider degrades to
 * the default look instead of throwing. Prefs are decoration; nothing about
 * them is worth a blank page.
 */
const PrefsContext = createContext<PrefsContextValue>({
  prefs: DEFAULT_PREFS,
  setPrefs: () => {},
});

function readCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.match(new RegExp(`(?:^|; )${PREFS_COOKIE}=([^;]*)`))?.[1];
}

export function PrefsProvider({
  children,
  country = "CN",
}: {
  children: React.ReactNode;
  /** Whose accent to apply. PR2 passes the open trip's country. */
  country?: string;
}) {
  // Lazy initialiser, reading the same cookie the inline script read, so React's
  // first render already agrees with the DOM the script produced.
  const [prefs, setPrefsState] = useState<UserPrefs>(() => parsePrefsCookie(readCookie()));

  const setPrefs = useCallback((next: UserPrefs) => {
    const clean = sanitizePrefs(next);
    setPrefsState(clean);
    document.cookie = `${PREFS_COOKIE}=${serializePrefsCookie(clean)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
    // Fire and forget: the cookie is already authoritative for rendering, so a
    // failed sync costs cross-device persistence and nothing the user can see.
    void fetch("/api/me/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean),
    }).catch((error) => {
      console.error("PrefsProvider: could not save preferences", error);
    });
  }, []);

  const accentVars = useMemo(
    () => resolveAccentVars(prefs, country, PINNED_THEME),
    [prefs, country]
  );

  // useLayoutEffect, not useEffect: this runs before paint, so it also repairs
  // the attribute after React's dev-mode Strict remount resets <html> to the
  // attributes it manages from JSX, clearing what the inline script set.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", PINNED_THEME);
    for (const [name, value] of Object.entries(accentVars)) {
      root.style.setProperty(name, value);
    }
  }, [accentVars]);

  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  return useContext(PrefsContext);
}
