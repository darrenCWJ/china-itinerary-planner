import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(__dirname, ".") };

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
          include: ["lib/**/*.test.ts"],
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
        },
      },
    ],
  },
});
