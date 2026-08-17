import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SearchableCurated } from "@/lib/placeSearch";
import { PlaceSearch, type PickedPlace } from "./PlaceSearch";

/**
 * The plan declines a test here; the ruling reinstates one, because the
 * acceptance criteria it names are behaviour: "↓↑ moves active option, Enter
 * adds, Esc clears, input keeps focus", plus `aria-activedescendant` listbox
 * semantics — the a11y path spec §9 requires.
 *
 * Nothing below asserts on appearance. The catalog fetch is stubbed: the
 * debounce and abort logic is CatalogSearch's proven pattern, and what matters
 * here is the keyboard.
 */

const CURATED: SearchableCurated[] = [
  { id: "hangzhou", name: "Hangzhou", localName: "杭州", knownFor: ["tea"] },
  { id: "harbin", name: "Harbin", localName: null, knownFor: [] },
];

function setup(selected: PickedPlace[] = []) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <PlaceSearch
      curated={CURATED}
      coordsFor={(id) => (id === "hangzhou" ? { lat: 30.25, lon: 120.16 } : null)}
      selected={selected}
      country="CN"
      onAdd={onAdd}
      onRemove={onRemove}
    />
  );
  const input = screen.getByRole("combobox");
  return { input, onAdd, onRemove };
}

/** Options in listbox order, as a keyboard user would traverse them. */
const optionTexts = () => screen.getAllByRole("option").map((o) => o.textContent ?? "");

const activeOptionText = () => {
  const input = screen.getByRole("combobox");
  const id = input.getAttribute("aria-activedescendant");
  if (id === null) return null;
  return document.getElementById(id)?.textContent ?? null;
};

describe("PlaceSearch keyboard path", () => {
  beforeEach(() => {
    // No network in these tests; ranking over the curated set plus the off-map
    // row is enough to exercise every key.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ available: true, results: [] }) })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("stays silent until something is typed", () => {
    setup();

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  test("opens a listbox and points aria-activedescendant at the first option", () => {
    const { input } = setup();

    fireEvent.change(input, { target: { value: "ha" } });

    expect(input).toHaveAttribute("aria-expanded", "true");
    // Two curated matches plus the off-map row.
    expect(optionTexts()).toHaveLength(3);
    expect(activeOptionText()).toContain("Hangzhou");
  });

  test("ArrowDown and ArrowUp move the active option", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeOptionText()).toContain("Harbin");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeOptionText()).toContain("Hangzhou");
  });

  test("ArrowUp from the first option wraps to the last", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "ArrowUp" });

    // The last row is always the off-map offer.
    expect(activeOptionText()).toContain("as its own place");
  });

  test("Enter adds the active place and clears the query", () => {
    const { input, onAdd } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({ id: "harbin", name: "Harbin", kind: "curated" });
    expect(input).toHaveValue("");
  });

  test("returns focus to the input after adding by mouse", () => {
    // Asserted on the mouse path, not the Enter path: pressing Enter never moves
    // focus in the first place, so asserting it there passes even with the
    // focus() call deleted — verified by probe. Clicking is where the call earns
    // its place, and it is what lets someone alternate mouse and keyboard.
    const { input, onAdd } = setup();
    fireEvent.change(input, { target: { value: "ha" } });
    input.blur();
    expect(input).not.toHaveFocus();

    fireEvent.mouseDown(screen.getAllByRole("option")[0]);

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(input).toHaveFocus();
  });

  test("carries coordinates for a curated pick and null for an off-map one", () => {
    const { input, onAdd } = setup();

    fireEvent.change(input, { target: { value: "hangzhou" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd.mock.calls[0][0]).toMatchObject({ lat: 30.25, lon: 120.16, country: "CN" });

    fireEvent.change(input, { target: { value: "Grandma's village" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Spec §5.6: hand-typed places have no location attached.
    expect(onAdd.mock.calls[1][0]).toMatchObject({
      kind: "off-map",
      name: "Grandma's village",
      lat: null,
      lon: null,
    });
  });

  test("Escape clears the query without adding anything", () => {
    const { input, onAdd } = setup();
    fireEvent.change(input, { target: { value: "ha" } });

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("refuses to add a place that is already selected", () => {
    const { input, onAdd } = setup([
      { id: "hangzhou", name: "Hangzhou", kind: "curated", lat: 30.25, lon: 120.16, country: "CN" },
    ]);
    fireEvent.change(input, { target: { value: "hangzhou" } });

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
    // Flagged, not hidden — a place that vanished on being added reads as a bug.
    expect(optionTexts()[0]).toContain("added");
  });

  test("removes a selected place through its own control", () => {
    const { onRemove } = setup([
      { id: "harbin", name: "Harbin", kind: "curated", lat: 45.8, lon: 126.5, country: "CN" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Harbin" }));

    expect(onRemove).toHaveBeenCalledWith("harbin");
  });

  test("Enter with no results does nothing", () => {
    const { input, onAdd } = setup();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
  });
});
