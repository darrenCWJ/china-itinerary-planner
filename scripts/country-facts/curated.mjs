/**
 * ingest-country-facts — `CURATED_FACTS`, the hand-verified overrides for
 * fields the withhold rules refuse.
 *
 * Moved verbatim out of scripts/ingest-country-facts.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-country-facts.mjs.
 *
 * This table sat inside that file's `// Pure build` section, between
 * `buildFacts` and `applyCurated`. Both of those are now
 * scripts/country-facts/facts.mjs, which imports the table from here; nothing
 * about which rows fire, or when a row is judged stale, moved with it.
 */

/**
 * Hand-verified values for fields the withhold rules refuse, with the upstream
 * shape that caused each withhold named in its comment.
 *
 * Design 3 shipped this table empty on the argument that withholding is honest
 * and sampling is not. Both halves of that are true and neither settles the
 * question: Poland with no currency at all reads as broken software, not as
 * restraint. A hand-verified value whose provenance is recorded is MORE honest
 * than silence, and it is not sampling — nothing here was chosen by a query.
 *
 * The `CURATED_HEROES` precedent (lib/countryImagery.ts) governs the rules: a
 * row is written only when a human verified it, and every row is asserted by a
 * test to actually FIRE. A row whose field upstream now supplies is stale, and
 * `assertFactsSane` refuses to write rather than letting it rot into silent
 * cruft. That deliberately reddens the nightly job on a GOOD upstream change,
 * which is the same trade `CN_CROSS_CHECK` makes below and for the same
 * reason: a human deleting one line is cheaper than a wrong answer nobody
 * noticed.
 */
export const CURATED_FACTS = {
  /**
   * Two upstream shapes, and the second one arrived a day after the first was
   * written.
   *
   * `currencyCode`/`currencyName`: P297 sits on Q29999 "Kingdom of the
   * Netherlands", so P38 yields EUR/USD/AWG/XCG.
   *
   * `name`/`emergency`/`lat`: at **2026-08-28T09:46:29Z** Q55 "Netherlands"
   * GAINED `P297 = "NL"` alongside Q29999, both at NormalRank. Every query in
   * this file anchors on `?c wdt:P297 ?country`, so `wdt:` now matches BOTH
   * items and each single-valued picker sees two answers and withholds — two
   * labels, two roleless emergency numbers, two P625 points. Measured the same
   * day with the shipping pipeline, NL only and BE as an unaffected control:
   * `factCount` 9 -> 7, over `COUNTRY_FIELD_LOSS_GRACE`, which aborted the
   * whole nightly refresh — the city catalog with it, since they share one
   * job. And it could not self-heal: a failed run writes nothing, so
   * `previous` keeps NL at 9 forever and every later run loses the same two.
   *
   * These are RESTORATIONS, not editorial calls: each value is the one the
   * committed artifact already carried and `lib/countries.ts` is reconciled
   * against, so this row returns the record to what shipped rather than
   * changing what a traveller reads. 112 is the number to dial in the European
   * Netherlands, which is the country this app plans trips to; the 911 upstream
   * now also offers belongs to the Caribbean constituents.
   *
   * If Wikidata resolves the split, these three go STALE and the run goes red
   * asking for them back out — the same anti-rot pairing the ZW row relies on.
   */
  NL: {
    currencyCode: 'EUR',
    currencyName: 'euro',
    name: 'Kingdom of the Netherlands',
    emergency: [{ number: '112', role: null }],
    lat: 52.366666666667,
  },
  /**
   * P38 yields EUR/XPF (the CFP franc of the Pacific collectivities), and
   * P2884 yields 400/230 — 400 V being industrial three-phase supply.
   */
  FR: { currencyCode: 'EUR', currencyName: 'euro', voltageV: 230 },
  /** P498 yields PLN and PLZ, the pre-1995 zloty: still ISO-shaped, still truthy. */
  PL: { currencyCode: 'PLN', currencyName: 'złoty' },
  /**
   * PL's shape again, and it arrived overnight. P38 yields BAM and BAD, the
   * 1992-1998 Bosnia and Herzegovina dinar: a QuickStatements batch on
   * 2026-08-31 (Q225, batches 51009-51023) added the dinar with start- and
   * end-time qualifiers but at NormalRank, the same rank as the convertible
   * mark, so `wdt:` returns both and `pickCurrency` sees two ISO-shaped codes
   * and withholds. Measured 2026-09-03 by the shipping queries, BA only:
   * every other field answers as before and `factCount` goes 9 -> 7, over
   * `COUNTRY_FIELD_LOSS_GRACE`. That reddened the nightly refresh on 08-31,
   * 09-01 and 09-02 and withheld the city catalog with it, because a failed
   * run writes nothing and so loses the same two fields every night after.
   *
   * A RESTORATION, not an editorial call: BAM / "convertible mark" is the
   * pair the committed artifact already carries, and it is the currency a
   * traveller is quoted in. The day upstream ranks the mark Preferred or
   * drops the dinar, this row goes stale and the run asks for it back out.
   */
  BA: { currencyCode: 'BAM', currencyName: 'convertible mark' },
  /**
   * P38 yields thirteen currencies. Measured 2026-08-27 by the shipping
   * query, they are EUR, CNY,
   * GBP, USD, JPY, AUD, ZWG, ZAR, ZWN, ZWR, ZWL, INR and ZWD — four of them
   * historical Zimbabwean dollars, so no rule that picks by shape can pick
   * correctly here. Zimbabwe's multi-currency regime makes USD
   * the unit a visitor is quoted in and pays in; ZWG, the 2024 gold-backed
   * unit, is neither obtainable abroad nor useful to a traveller. This is the
   * currency the money pivot and the cash-backup packing line are about, so it
   * is the traveller-facing one, and this comment is the record of that
   * judgement rather than a claim about legal tender.
   *
   * Re-examined at Task 25 against the live answer above rather than carried
   * forward on trust, because the value was an editorial call the design named
   * a row for without naming a value. Kept: USD is in the upstream set, it is
   * what a visitor is quoted and pays in, and the two alternatives a rule
   * could have reached for are both worse — ZWG is unobtainable abroad, and
   * "pick the one ISO-shaped value" is undefined when thirteen qualify. The
   * row still FIRES, which `applyCurated` records and `assertFactsSane`
   * enforces: the day Wikidata reduces ZW to one currency, this goes red
   * rather than rotting.
   */
  ZW: { currencyCode: 'USD', currencyName: 'United States dollar' },
  /** P38 yields HKD/MOP, because the item covers the wider administrative history. */
  MO: { currencyCode: 'MOP', currencyName: 'Macanese pataca' },
  /**
   * Every one of Belgium's three P37 statements is `applies to part`, so
   * `pickLanguages` withholds the whole field — correctly as a RULE, wrongly
   * as an ANSWER, and the difference is what this row records.
   *
   * Measured 2026-08-27 by the shipping query: 36 truthy statement rows over
   * exactly THREE distinct items — Dutch (Q7411), French (Q150) and German
   * (Q188) — and the P518 qualifier on each names a region or a municipality
   * INSIDE Belgium: Flanders, the Walloon Region, the Brussels-Capital
   * Region, the German-speaking Community, and the language-facility communes
   * (Welkenraedt, Mouscron, Comines-Warneton, Voeren, Linkebeek and the rest).
   *
   * That is the opposite of the United States shape the rule was written for.
   * There, the scope qualifier said "this language is official in a territory
   * and the country as a whole has no such claim". Here it says "this is
   * WHICH of the country's three national languages governs WHERE" — Article
   * 4 of the Belgian Constitution divides the country into four language
   * regions, so a per-region qualifier is how upstream encodes a fact that IS
   * national. Dutch, French and German is the constitutional trio; it is what
   * a Belgian passport is printed in and what `languageTip` should say.
   *
   * The rule stays whole-field, because it cannot tell those two shapes apart
   * without reading the qualifier's VALUE and deciding whether that value is
   * a part of the country or a territory beside it — a judgement about
   * sovereignty, not a shape a picker can check. So the judgement is made
   * here, by a human, once, with the upstream shape recorded beside it.
   */
  BE: { officialLanguages: ['Dutch', 'French', 'German'] },
  /**
   * Azerbaijan's withhold is the same rule and a third shape again: the P518
   * qualifier names neither a part of the country nor a territory beside it,
   * but a VARIETY of the language.
   *
   * Measured 2026-08-27: two truthy statements. Azerbaijani (Q9292) is
   * qualified `applies to part: Standard Azerbaijani` — upstream saying which
   * register is official, which is a refinement of a national claim rather
   * than a limit on it. Azerbaijani Sign Language (Q55698568) is unqualified.
   * `pickLanguages`'s own doc-comment already names why the remainder cannot
   * be published: it leaves the sign language ALONE, and `languageTip` renders
   * a one-item list as "Azerbaijani Sign Language is the official language".
   *
   * Article 21 of Azerbaijan's constitution makes Azerbaijani the state
   * language, singular. That is the value here. The sign language is
   * deliberately NOT included: it is recognised, it is not the language a
   * traveller needs a phrasebook for, and this field feeds a packing line
   * about offline translation packs.
   */
  AZ: { officialLanguages: ['Azerbaijani'] },
};

