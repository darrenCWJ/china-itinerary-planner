// components/plan/GapNote.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GapNote } from "./GapNote";

// This file's third test renders after the second and asserts the second's
// label is gone — without this, both would sit in the same document (the
// project's established pattern; see components/map/FitLegend.test.tsx).
afterEach(cleanup);

describe("GapNote", () => {
  test("renders nothing for no lines", () => {
    const { container } = render(<GapNote lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("is a note named for the tip surfaces by default", () => {
    render(<GapNote lines={["Source: Wikidata.", "Missing: currency."]} />);
    const note = screen.getByRole("note", { name: "About these notes" });
    expect(note.textContent).toContain("Missing: currency.");
  });

  test("takes the name a surface gives it", () => {
    render(<GapNote label="About the climate colours" lines={["Derived from grid normals."]} />);
    expect(screen.getByRole("note", { name: "About the climate colours" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "About these notes" })).not.toBeInTheDocument();
  });
});
