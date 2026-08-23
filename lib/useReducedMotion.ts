"use client";

import { useEffect, useState } from "react";

/**
 * Whether the user has asked the OS for reduced motion.
 *
 * `app/globals.css:134` already flattens every CSS animation and transition
 * under this query, but the globe's rotation is JavaScript recomputing a
 * projection — CSS cannot reach it. This is how a render decision reads the
 * same preference.
 *
 * Starts `false` and is corrected by the effect, rather than reading
 * `matchMedia` during render. Two reasons, both real: `/plan` is prerendered,
 * so a module- or render-scope `matchMedia` read is a build failure, not a
 * runtime one; and the first client render must agree with the server-rendered
 * markup or hydration mismatches. `PrefsProvider` starts its `systemDark` the
 * same way, for the same reasons.
 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
