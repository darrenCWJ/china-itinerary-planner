"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The width the §5.3.2 tap target is sized against, measured rather than
 * assumed. Moved verbatim out of CountryLevel.tsx on 2026-09-07 so that file
 * stays under the 800-line guidance; the docblock below is that file's.
 */

/**
 * The container's own width in CSS pixels, or null while there is nothing to
 * measure.
 *
 * §5.3.2's target is specified in CSS pixels and drawn in viewBox units, and
 * only the browser knows the ratio between them: `w-full` hands the width to
 * the layout, so a phone, a tablet and a desktop column each produce a
 * different one. Measuring is the only way to honour a pixel token from inside
 * a scaled viewBox — any compile-time constant is correct at exactly one width
 * and wrong at all the others.
 *
 * `useEffect` rather than `useLayoutEffect`: this is a `"use client"` component
 * that Next still renders on the server, where a layout effect is a warning and
 * a no-op. The cost is one commit at `TAP_MIN_R_FALLBACK`, and the circle it
 * sizes is `fill="transparent"`, so nothing visible moves when it is replaced.
 *
 * The observer is what carries it through a rotation or a window drag, both of
 * which change the ratio without remounting anything. jsdom implements no
 * `ResizeObserver`, so there the mount measurement stands alone.
 */
export function useRenderedWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      const measured = node.getBoundingClientRect().width;
      // 0 is what jsdom answers for everything and what a browser answers for
      // a `display: none` subtree. Neither is a width to divide by.
      setWidth(measured > 0 ? measured : null);
    };
    measure();

    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
