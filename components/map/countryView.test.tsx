// First, before any import that could reach `./mapTypes` or `@/lib/dragLayer`:
// the harness registers those mocks, and vitest hoists a mock only above the
// imports of the file that declares it.
import { CUSCO, installCountryLevelHarness, ISLA, LIMA } from "@/test/countryLevelHarness";
import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ProjectionEntry } from "@/lib/countryProjection";
import type { ProvinceFile } from "@/lib/provinceTopology";
import { CountryLevel } from "./CountryLevel";
import { buildCountryView } from "./countryView";
import { PE_ENTRY, PE_FILE } from "./countryFixture";

installCountryLevelHarness();

/**
 * What the view memo hands the rest of the level.
 *
 * It used to hand over three things — the unit paths, the merged outline and a
 * projector for lon/lat — and throw away the two the province zoom needs: the
 * path generator, and the units as geometry rather than as `d` strings.
 * `transformForFeatures` takes exactly that pair, so a zoom that could not
 * reach them would have to build a second projection of its own, on every
 * region click, to answer a question this pass already answered.
 *
 * The memo is where that matters. It is the expensive half of the file — a
 * TopoJSON decode, a `merge()` over every unit and one path render each — and
 * it is keyed on the topology alone. Returning more must not turn it into a
 * memo keyed on the zoom.
 */
describe("CountryLevel view", () => {
  test("exposes a bounds accessor per unit without re-projecting", () => {
    const view = buildCountryView(PE_FILE, PE_ENTRY);

    // Selectable units only, and drawn ones only. A group's `unitIds` come
    // from `regionSchemeFor`, which drops `sel: 0` for §7.2's reason — the
    // disputed zone shapes this country's outline and is not a place anyone
    // travels to — so the set that can be zoomed to is exactly the set
    // `data-unit` marks, and a lookup that should miss cannot be made to hit.
    expect(view.units.map((u) => u.id)).toEqual(["PE-LIM", "PE-CUS", "PE-XXX", "PE-ISL"]);
    expect([...view.selectableFeatures.keys()]).toEqual(["PE-LIM", "PE-CUS", "PE-ISL"]);

    // The generator that drew the country, kept rather than rebuilt: it
    // reproduces every committed path exactly, so what a zoom measures is the
    // frame the user is already looking at.
    for (const unit of view.units) {
      const shape = view.selectableFeatures.get(unit.id);
      if (shape) expect(view.pathGen(shape)).toBe(unit.d);
    }

    // And the pair IS the bounds accessor, answering per unit rather than per
    // country. `PE_ENTRY` frames the mainland flush across the padded box, so
    // x is 840 units over 6° — 140 per degree, `x(lon) = 10 + (lon + 78) * 140`
    // — and each unit's own longitudes fall out of it.
    const xOf = (id: string): [number, number] => {
      const feat = view.selectableFeatures.get(id);
      if (!feat) throw new Error(`no feature for ${id}`);
      const [[x0], [x1]] = view.pathGen.bounds(feat);
      return [x0, x1];
    };
    // Only x: a parallel is not a straight line under d3's resampling, so the
    // rings bulge in y and the corner latitudes are not the y bounds.
    expect(xOf("PE-LIM")).toEqual([expect.closeTo(10, 6), expect.closeTo(290, 6)]);
    expect(xOf("PE-CUS")).toEqual([expect.closeTo(290, 6), expect.closeTo(570, 6)]);
    // The island the §5.4 trim leaves out of frame is measurable too — 32° west
    // of the mainland, and so is its zoom.
    expect(xOf("PE-ISL")).toEqual([expect.closeTo(-4470, 6), expect.closeTo(-4330, 6)]);
  });

  test("the memo still runs once per topology, not once per zoom", () => {
    // The dependency array is the whole of this memo's policy, and adding the
    // zoom to it is the mistake returning more invites: the decode, the
    // `merge()` and one `pathGen` call per unit would re-run on every region
    // click to produce the same four paths.
    //
    // `provinces.topology` is read by `buildCountryView` and by nothing else,
    // so a getter on it counts the builds exactly. `provinces.units` is read
    // once by that build — for the id-to-unit join — and once by
    // `regionSchemeFor`, which is the other per-country pass this level runs;
    // counting both is what pins that a zoom re-runs NEITHER of them.
    let decodes = 0;
    let unitReads = 0;
    const counted: ProvinceFile = {
      ...PE_FILE,
      get topology() {
        decodes++;
        return PE_FILE.topology;
      },
      get units() {
        unitReads++;
        return PE_FILE.units;
      },
    };
    const props = {
      country: "PE",
      provinces: counted,
      projection: PE_ENTRY as ProjectionEntry | null,
      places: [LIMA, CUSCO, ISLA],
      selected: [] as string[],
      month: 10,
      routeIds: [] as string[],
      onTogglePlace: vi.fn(),
      onHoverPlace: vi.fn(),
    };

    const { rerender } = render(<CountryLevel {...props} />);
    expect(decodes).toBe(1);
    expect(unitReads).toBe(2);

    // Everything a zoom changes alongside itself, and the zoom.
    rerender(
      <CountryLevel
        {...props}
        places={[CUSCO, LIMA, ISLA]}
        selected={["lima"]}
        month={3}
        routeIds={["lima", "cusco"]}
        region="PE-ISL"
      />
    );
    expect(decodes).toBe(1);
    expect(unitReads).toBe(2);
  });
});
