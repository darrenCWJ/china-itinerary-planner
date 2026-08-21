import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { accentColor } from "@/lib/accent";
import { DEFAULT_PREFS, type UserPrefs } from "@/lib/prefs";
import { PrefsProvider, usePrefs } from "./PrefsProvider";

function clearCookies() {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

/**
 * jsdom implements no `window.matchMedia` at all, so the provider's system-theme
 * listener has nothing to attach to and every test would throw on the "system"
 * path. This installs the smallest stand-in that covers what the provider
 * actually uses — a `matches` flag and a `change` listener — and hands back an
 * `emit` so a test can move the system preference mid-session, which is the one
 * behaviour a static `matches` cannot express.
 */
function matchMediaMock(matches: boolean): { emit(next: boolean): void } {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches,
    media: DARK_QUERY,
    addEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void) {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal("matchMedia", vi.fn(() => list));
  return {
    emit(next: boolean) {
      list.matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

beforeEach(() => {
  clearCookies();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  // Light unless a test says otherwise, so only the tests that care about the
  // system preference have to mention it.
  matchMediaMock(false);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  // vitest runs without globals, so testing-library never registers its own
  // afterEach cleanup — without this every render stacks up in one document.
  cleanup();
  vi.unstubAllGlobals();
  clearCookies();
});

function Probe() {
  const { prefs } = usePrefs();
  return <output>{JSON.stringify(prefs)}</output>;
}

describe("PrefsProvider", () => {
  test("renders its children", () => {
    render(
      <PrefsProvider>
        <p>trip shell</p>
      </PrefsProvider>
    );

    expect(screen.getByText("trip shell")).toBeInTheDocument();
  });

  test("reads the stored preferences out of the cookie", () => {
    document.cookie = "cip-prefs=theme=dark&accent=210&hues=CN:200; Path=/";

    render(
      <PrefsProvider>
        <Probe />
      </PrefsProvider>
    );

    expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({
      theme: "dark",
      accent: 210,
      accentHues: { CN: 200 },
    });
  });

  test("falls back to the defaults with no cookie", () => {
    render(
      <PrefsProvider>
        <Probe />
      </PrefsProvider>
    );

    expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual(DEFAULT_PREFS);
  });

  test("applies the stored dark theme to the document", () => {
    document.cookie = "cip-prefs=theme=dark&accent=country; Path=/";

    render(
      <PrefsProvider>
        <span />
      </PrefsProvider>
    );

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("resolves system against the media query", () => {
    matchMediaMock(true);
    document.cookie = "cip-prefs=theme=system&accent=country; Path=/";

    render(
      <PrefsProvider>
        <span />
      </PrefsProvider>
    );

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("follows the system preference when it changes mid-session", () => {
    const mq = matchMediaMock(false);
    document.cookie = "cip-prefs=theme=system&accent=country; Path=/";

    render(
      <PrefsProvider>
        <span />
      </PrefsProvider>
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    act(() => mq.emit(true));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("applies the country's accent variables to the document", () => {
    render(
      <PrefsProvider country="CN">
        <Probe />
      </PrefsProvider>
    );

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--accent-ink")).toBe(accentColor("CN", "light", "ink"));
    expect(style.getPropertyValue("--accent-fill")).toBe(accentColor("CN", "light", "fill"));
  });

  test("a stored override moves the accent variables", () => {
    document.cookie = "cip-prefs=theme=light&accent=country&hues=CN:200; Path=/";

    render(
      <PrefsProvider country="CN">
        <Probe />
      </PrefsProvider>
    );

    expect(document.documentElement.style.getPropertyValue("--accent-ink")).toBe(
      accentColor("CN", "light", "ink", 200)
    );
  });

  test("saving preferences updates state, the cookie and the server", async () => {
    const next: UserPrefs = { theme: "dark", accent: 120, accentHues: { JP: 40 } };
    let save: (p: UserPrefs) => void = () => {};

    function Saver() {
      const { prefs, setPrefs } = usePrefs();
      save = setPrefs;
      return <output>{JSON.stringify(prefs)}</output>;
    }

    render(
      <PrefsProvider>
        <Saver />
      </PrefsProvider>
    );

    await act(async () => save(next));

    expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual(next);
    expect(document.cookie).toContain("cip-prefs=theme=dark&accent=120&hues=JP:40");
    expect(fetch).toHaveBeenCalledWith(
      "/api/me/prefs",
      expect.objectContaining({ method: "PUT" })
    );
  });

  test("saving dark flips the document without a reload", () => {
    // The cookie and the attribute move together: a preference that only took
    // effect on the next navigation would read as a broken toggle.
    let save: (p: UserPrefs) => void = () => {};

    function Saver() {
      save = usePrefs().setPrefs;
      return null;
    }

    render(
      <PrefsProvider>
        <Saver />
      </PrefsProvider>
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    act(() => save({ theme: "dark", accent: "country", accentHues: {} }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("publishes the resolved ramp on context, not the three-valued preference", () => {
    // WorldMap and CountryHero read this instead of resolving the theme a
    // second time locally, which is what stops the map disagreeing with the
    // page it sits on.
    matchMediaMock(true);
    document.cookie = "cip-prefs=theme=system&accent=country; Path=/";
    let seen: string | undefined;

    function ThemeProbe() {
      seen = usePrefs().theme;
      return null;
    }

    render(
      <PrefsProvider>
        <ThemeProbe />
      </PrefsProvider>
    );

    expect(seen).toBe("dark");
  });

  test("a failing save is swallowed rather than crashing the shell", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let save: (p: UserPrefs) => void = () => {};

    function Saver() {
      save = usePrefs().setPrefs;
      return null;
    }

    render(
      <PrefsProvider>
        <Saver />
      </PrefsProvider>
    );

    await act(async () => save({ theme: "system", accent: "country", accentHues: {} }));

    expect(document.cookie).toContain("theme=system");
    consoleError.mockRestore();
  });

  test("usePrefs outside a provider still returns usable defaults", () => {
    // A component rendered outside the shell should degrade, not throw: prefs
    // are decoration, and nothing about them is worth a blank page.
    render(<Probe />);

    expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual(DEFAULT_PREFS);
  });
});
