import { NextResponse } from "next/server";
import { findAirport } from "./airports";

/**
 * The refusal every door that accepts a gateway code makes, in the same
 * words, for the same reason (spec §10.3).
 *
 * The editor suggests real airports but stays a text field, so a typo arrives
 * as a well-formed unknown code, and a gateway nothing can draw or name is
 * not worth storing. There are three doors — create, the rebuild (PATCH) and
 * PUT /gateways — and they have to agree: a code one of them lets in that
 * another refuses is a trip that can never afterwards be edited, because
 * /gateways sends both sides and would refuse the trip's own stored value.
 *
 * Null and absent are not codes and pass: null is the traveller's "none",
 * absent is a client that said nothing. Only a code the artifact lacks is
 * refused.
 */
export function refuseUnknownGateways(
  codes: ReadonlyArray<string | null | undefined>
): NextResponse | null {
  for (const code of codes) {
    if (code != null && findAirport(code) === null) {
      return NextResponse.json({ error: `Unknown airport code ${code}` }, { status: 400 });
    }
  }
  return null;
}
