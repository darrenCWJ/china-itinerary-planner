import path from "node:path";
import { defineConfig } from "vitest/config";

// `import.meta.dirname`, not `__dirname`: this file is .mts so Vite loads it as
// real ESM, where the CommonJS globals do not exist.
const alias = { "@": path.resolve(import.meta.dirname, ".") };

/**
 * Two projects, split by file extension so their includes cannot overlap:
 * pure logic is `.test.ts` and runs in node; anything that renders is
 * `.test.tsx` and runs in jsdom. Every test predating the split is `.test.ts`
 * under lib/, so it stays in the node project untouched.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          // scripts/**: ingest-airports.test.ts exercises buildAirports and
          // assertSane, the only gate standing between a corrupt upstream feed
          // and an unattended production deploy. Before this, no include
          // pattern matched anything under scripts/, so a test file placed
          // there would sit on disk and never run.
          include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["components/**/*.test.tsx", "lib/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          // MapExplorer.test.tsx times out under full-suite parallel load on
          // the 5s default (it passes in isolation) — contention, not a real
          // hang. A known-flaky test in a repo whose only gate is `npm test`
          // trains people to re-run reds, which is how a real one gets waved
          // through, so give this project real headroom instead.
          testTimeout: 15000,
        },
      },
    ],
  },
});
