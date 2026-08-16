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

beforeEach(() => {
  clearCookies();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
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

  test("pins data-theme to light even when the stored theme is dark", () => {
    // PR1 stores the preference but does not honour it: the components that
    // exist today hardcode light palette utilities, so flipping the attribute
    // would half-restyle the app. PR2 removes this pin.
    document.cookie = "cip-prefs=theme=dark&accent=country; Path=/";

    render(
      <PrefsProvider>
        <Probe />
      </PrefsProvider>
    );

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
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

  test("the theme stays pinned to light even after saving dark", () => {
    // Persisting the choice and honouring it are separate things in PR1.
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

    act(() => save({ theme: "dark", accent: "country", accentHues: {} }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
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
