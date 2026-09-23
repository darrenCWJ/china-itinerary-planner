/**
 * ingest-country-facts — the per-country official-language comparison and the
 * acceptance a human gives it, one function at a time.
 *
 * The three gate branches built from these are pinned in
 * scripts/country-facts/gate.test.ts, and their place in the path a nightly
 * run takes in scripts/ingest-country-facts.test.ts. No network call is made
 * anywhere in this file.
 */

import { describe, expect, test } from "vitest";
import {
  ACCEPT_LANGUAGE_CHANGES_ENV,
  describeLanguageChanges,
  languageChanges,
  parseAcceptedLanguageChanges,
  summariseLanguageChanges,
} from "./languages.mjs";

type Countries = Record<string, { officialLanguages?: string[] }>;

/** A `countries` map from bare lists; `undefined` is a country with no language field. */
function lists(entries: Record<string, string[] | undefined>): Countries {
  return Object.fromEntries(
    Object.entries(entries).map(([code, officialLanguages]) => [
      code,
      officialLanguages === undefined ? {} : { officialLanguages },
    ])
  );
}

describe("languageChanges", () => {
  test("an unchanged artifact has nothing to report", () => {
    const countries = lists({ IQ: ["Arabic", "Kurdish"], MR: ["Arabic"], US: undefined });
    expect(languageChanges(countries, structuredClone(countries))).toEqual([]);
  });

  test("an added language is named, for that country alone — Mauritania's shape", () => {
    expect(
      languageChanges(lists({ IQ: ["Arabic"], MR: ["Arabic"] }), lists({ IQ: ["Arabic"], MR: ["Arabic", "French"] }))
    ).toEqual([{ code: "MR", removed: [], added: ["French"], withdrawn: false, appeared: false }]);
  });

  test("a removed language is named — Kyrgyzstan's shape", () => {
    expect(languageChanges(lists({ KG: ["Kyrgyz", "Russian"] }), lists({ KG: ["Kyrgyz"] }))).toEqual([
      { code: "KG", removed: ["Russian"], added: [], withdrawn: false, appeared: false },
    ]);
  });

  test("a relabel is one name out and one name in — Iraq's shape", () => {
    expect(
      languageChanges(lists({ IQ: ["Arabic", "Kurdish"] }), lists({ IQ: ["Arabic", "Kurdish language"] }))
    ).toEqual([{ code: "IQ", removed: ["Kurdish"], added: ["Kurdish language"], withdrawn: false, appeared: false }]);
  });

  test("a swap between two countries is two changes, although the total does not move", () => {
    const previous = lists({ AA: ["English", "French"], AB: ["English"] });
    const next = lists({ AA: ["English"], AB: ["English", "French"] });
    const total = (countries: Countries) =>
      Object.values(countries).reduce((sum, record) => sum + (record.officialLanguages?.length ?? 0), 0);
    // Armed: this is the build a 426-style total passes untouched.
    expect(total(next)).toBe(total(previous));
    expect(languageChanges(previous, next)).toEqual([
      { code: "AA", removed: ["French"], added: [], withdrawn: false, appeared: false },
      { code: "AB", removed: [], added: ["French"], withdrawn: false, appeared: false },
    ]);
  });

  test("a field withdrawn and a field appearing say so", () => {
    expect(
      languageChanges(lists({ EH: undefined, UY: ["Spanish"] }), lists({ EH: ["Arabic"], UY: undefined }))
    ).toEqual([
      { code: "EH", removed: [], added: ["Arabic"], withdrawn: false, appeared: true },
      { code: "UY", removed: ["Spanish"], added: [], withdrawn: true, appeared: false },
    ]);
  });

  test("a country on one side only is its whole list appearing or going", () => {
    expect(languageChanges(lists({ XA: ["English"] }), lists({ XB: ["French"] }))).toEqual([
      { code: "XA", removed: ["English"], added: [], withdrawn: true, appeared: false },
      { code: "XB", removed: [], added: ["French"], withdrawn: false, appeared: true },
    ]);
  });

  test("order is not a change: the lists are compared as sets", () => {
    expect(
      languageChanges(lists({ BE: ["German", "Dutch", "French"] }), lists({ BE: ["Dutch", "French", "German"] }))
    ).toEqual([]);
  });

  test("country codes in the result are sorted even when both sides have them out of order", () => {
    const result = languageChanges(lists({ MR: ["Arabic"] }), lists({ IQ: ["Arabic"] }));
    expect(result.map((r) => r.code)).toEqual(["IQ", "MR"]);
  });

  test("removed and added names within a single change are sorted alphabetically", () => {
    const result = languageChanges(
      lists({ ZA: ["Zulu", "Xhosa", "English"] }),
      lists({ ZA: ["English", "Venda", "Afrikaans"] })
    );
    expect(result).toHaveLength(1);
    const change = result[0];
    expect(change.removed).toEqual(["Xhosa", "Zulu"]);
    expect(change.added).toEqual(["Afrikaans", "Venda"]);
  });
});

describe("summariseLanguageChanges", () => {
  test("quotes every name and puts removals first, so a relabel reads from -> to", () => {
    const changes = languageChanges(lists({ IQ: ["Arabic", "Kurdish"] }), lists({ IQ: ["Arabic", "Kurdish language"] }));
    expect(summariseLanguageChanges(changes)).toBe('IQ: -"Kurdish" +"Kurdish language"');
  });

  test("one relabel reaching many countries is one entry, not one per country", () => {
    const changes = languageChanges(
      lists({ CY: ["Greek", "Turkish"], MR: ["Arabic"], TR: ["Turkish"] }),
      lists({ CY: ["Greek", "Turkish language"], MR: ["Arabic", "French"], TR: ["Turkish language"] })
    );
    expect(summariseLanguageChanges(changes)).toBe('CY, TR: -"Turkish" +"Turkish language"; MR: +"French"');
  });

  test("says why a field was withdrawn when the build knows, and says so when it does not", () => {
    const changes = languageChanges(lists({ PW: ["English"], UY: ["Spanish"] }), lists({ PW: undefined, UY: undefined }));
    expect(summariseLanguageChanges(changes, { scoped: ["PW"] })).toBe(
      'PW: -"English" (field withdrawn: every statement is now territorially scoped); ' +
        'UY: -"Spanish" (field withdrawn: no publishable statement came back)'
    );
  });

  test("marks a field that is new", () => {
    const changes = languageChanges(lists({ EH: undefined }), lists({ EH: ["Arabic"] }));
    expect(summariseLanguageChanges(changes)).toBe('EH: +"Arabic" (field new)');
  });

  test("groups entries are sorted by country code even when passed in reverse order with different signatures", () => {
    const changes = [
      { code: "MR", removed: [], added: ["French"], withdrawn: false, appeared: false },
      { code: "IQ", removed: ["Kurdish"], added: ["Kurdish language"], withdrawn: false, appeared: false }
    ];
    const result = summariseLanguageChanges(changes);
    expect(result).toBe('IQ: -"Kurdish" +"Kurdish language"; MR: +"French"');
  });
});

describe("describeLanguageChanges", () => {
  test("names the change, why it stops the run, and the three answers, down to the acceptance to copy", () => {
    const changes = languageChanges(
      lists({ IQ: ["Arabic", "Kurdish"], MR: ["Arabic"] }),
      lists({ IQ: ["Arabic", "Kurdish language"], MR: ["Arabic", "French"] })
    );
    const message = describeLanguageChanges(changes);
    expect(message).toMatch(
      /^2 countries changed their published official languages since the committed artifact: IQ: -"Kurdish" \+"Kurdish language"; MR: \+"French" — a published language list never changes without a human\./
    );
    expect(message).toContain("REFUSED_LANGUAGE_ITEMS");
    expect(message).toContain("CURATED_FACTS");
    expect(message).toContain("CIP_ACCEPT_LANGUAGE_CHANGES=IQ,MR and committing the regenerated artifact");
  });

  test("one country is singular", () => {
    const changes = languageChanges(lists({ MR: ["Arabic"] }), lists({ MR: ["Arabic", "French"] }));
    expect(describeLanguageChanges(changes)).toMatch(/^1 country changed its published official languages/);
  });

  test("suggests every country that changed, including one a human already accepted", () => {
    // Copying a suggestion that dropped the accepted country would un-accept it.
    const changes = languageChanges(lists({ AB: ["English"] }), lists({ AB: ["English", "German"] }));
    expect(describeLanguageChanges(changes, { accept: ["AA", "AB"] })).toContain(
      "CIP_ACCEPT_LANGUAGE_CHANGES=AA,AB and committing"
    );
  });
});

describe("parseAcceptedLanguageChanges", () => {
  test("is the variable the documented command sets", () => {
    expect(ACCEPT_LANGUAGE_CHANGES_ENV).toBe("CIP_ACCEPT_LANGUAGE_CHANGES");
  });

  test("an unset or blank variable accepts nothing", () => {
    expect(parseAcceptedLanguageChanges(undefined)).toEqual([]);
    expect(parseAcceptedLanguageChanges("")).toEqual([]);
    expect(parseAcceptedLanguageChanges("   ")).toEqual([]);
  });

  test("reads one code, several, and spaces around them", () => {
    expect(parseAcceptedLanguageChanges("IQ")).toEqual(["IQ"]);
    expect(parseAcceptedLanguageChanges("IQ,MR")).toEqual(["IQ", "MR"]);
    expect(parseAcceptedLanguageChanges(" IQ , MR ")).toEqual(["IQ", "MR"]);
  });

  test.each(["iq", "IQX", "I", "IQ,", ",IQ", "IQ,,MR", "IQ;MR", "IQ MR"])(
    "refuses %j rather than reading it generously",
    (raw) => {
      expect(() => parseAcceptedLanguageChanges(raw)).toThrow(
        /CIP_ACCEPT_LANGUAGE_CHANGES must be two-letter uppercase country codes separated by commas/
      );
    }
  );

  test("refuses a code named twice", () => {
    expect(() => parseAcceptedLanguageChanges("IQ,MR,IQ")).toThrow(
      /CIP_ACCEPT_LANGUAGE_CHANGES names IQ more than once/
    );
  });
});
