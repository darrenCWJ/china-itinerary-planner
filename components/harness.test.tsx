import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

/**
 * Canary for the jsdom vitest project. If this fails, component and hook
 * tests are not running — check that vitest.config.ts still defines the
 * jsdom project and that vitest.setup.ts is loaded.
 */
function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe("component test harness", () => {
  test("renders a component into a real DOM", () => {
    render(<Greeting name="Darren" />);

    expect(screen.getByText("Hello Darren")).toBeInTheDocument();
  });

  test("exposes a document, which the node project does not", () => {
    expect(typeof document).toBe("object");
  });
});
