import "@testing-library/jest-dom/vitest";

// Without this, every act() call emits "The current testing environment is
// not configured to support act(...)" to stderr — same fix already used
// locally in lib/useTripPayload.test.tsx, hoisted here so it covers the
// whole jsdom suite instead of one file at a time.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
