/**
 * Geometry for the desktop drag layer (spec §3.2.5).
 *
 * Drag is layered *on top* of tap-to-target, so nothing here decides what a drop
 * means — it only turns a pointer position into an index, and an index change
 * into the sequence of moves the existing controls already emit. That split is
 * the point: the drag feel is visual and verified by hand, but the arithmetic
 * underneath it is where an off-by-one silently reorders somebody's shared plan,
 * so it lives here with a test.
 *
 * Pure and free of React and the DOM. `Rect` is structurally satisfied by a
 * `DOMRect`, so callers pass `getBoundingClientRect()` straight in.
 */

/** Vertical extent of one row, in client coordinates. */
export interface Box {
  top: number;
  height: number;
}

export interface Rect extends Box {
  left: number;
  width: number;
}

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
  );
}

/**
 * Which slot the pointer is over, as an **insertion index** in `0..boxes.length`.
 *
 * Each row is tested against its own midpoint rather than a uniform stride: a
 * timed block carries three more controls than an untimed one, so rows in the
 * day list differ in height by a factor of two and a stride-based guess drifts
 * further with every row.
 *
 * `boxes` must be in the order the rows are painted, top to bottom — the same
 * order as `day.items`, which `reflow` preserves (it never sorts). A pointer in
 * the gap between two rows resolves to the row below it, which is the boundary a
 * user reads as "between these two".
 */
export function dropIndexFor(pointerY: number, boxes: readonly Box[]): number {
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (pointerY < box.top + box.height / 2) return index;
  }
  return boxes.length;
}

/**
 * The adjacent swaps that carry the row at `fromIndex` to `insertionIndex`.
 *
 * `moveItem` is a raw adjacent-index swap and the server has no insert-at-index
 * op, so a drag across three rows is three ops — exactly what three presses of
 * the "move up" control emit. Returning the sequence rather than a target index
 * keeps drag and keyboard on one mutation path.
 *
 * An insertion index either side of the row itself is a no-op, not a one-step
 * move: dropping a row back where it already sits must not POST anything.
 */
export function moveStepsFor(
  fromIndex: number,
  insertionIndex: number
): readonly ("up" | "down")[] {
  // Removing the row first shifts every later slot down by one, so an insertion
  // point below the row lands one index earlier than it reads.
  const target = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
  const distance = target - fromIndex;
  const direction = distance < 0 ? "up" : "down";
  return Array.from({ length: Math.abs(distance) }, () => direction);
}
