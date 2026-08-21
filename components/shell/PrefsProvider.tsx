"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { AccentTheme } from "@/lib/accent";
import {
  DEFAULT_PREFS,
  PREFS_COOKIE,
  parsePrefsCookie,
  resolveAccentVars,
  sanitizePrefs,
  serializePrefsCookie,
  type ThemePref,
  type UserPrefs,
} from "@/lib/prefs";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The stored preference is one of three; the ramp is one of two. */
function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): AccentTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

const YEAR_SECONDS = 60 * 60 * 24 * 365;

interface PrefsContextValue {
  prefs: UserPrefs;
  setPrefs(next: UserPrefs): void;
  /**
   * The resolved ramp, published once so every surface reads the same answer.
   * `WorldMap` and `CountryHero` default their `theme` prop from this rather
   * than resolving it again locally, which is what stops a component
   * disagreeing with the page it sits on.
   */
  theme: AccentTheme;
}

/**
 * Defaults rather than undefined, so `usePrefs` outside a provider degrades to
 * the default look instead of throwing. Prefs are decoration; nothing about
 * them is worth a blank page.
 */
const PrefsContext = createContext<PrefsContextValue>({
  prefs: DEFAULT_PREFS,
  setPrefs: () => {},
  theme: "light",
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

  // `false` until the effect corrects it, and deliberately so: the inline
  // script in app/layout has already set the attribute from the same cookie and
  // the same media query before React ran, so the one-frame default is never
  // painted. Reading matchMedia during render would break the server pass.
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    setSystemDark(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme = resolveTheme(prefs.theme, systemDark);

  const accentVars = useMemo(
    () => resolveAccentVars(prefs, country, theme),
    [prefs, country, theme]
  );

  // useLayoutEffect, not useEffect: this runs before paint, so it also repairs
  // the attribute after React's dev-mode Strict remount resets <html> to the
  // attributes it manages from JSX, clearing what the inline script set.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    for (const [name, value] of Object.entries(accentVars)) {
      root.style.setProperty(name, value);
    }
  }, [accentVars, theme]);

  const value = useMemo(() => ({ prefs, setPrefs, theme }), [prefs, setPrefs, theme]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  return useContext(PrefsContext);
}
