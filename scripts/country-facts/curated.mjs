/**
 * ingest-country-facts — `CURATED_FACTS`, the hand-verified overrides for
 * fields the withhold rules refuse, and `REFUSED_LANGUAGE_ITEMS`, the
 * hand-verified refusals of statements they would publish.
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
   * P297 sits on Q29999 "Kingdom of the Netherlands", so P38 yields
   * EUR/USD/AWG/XCG.
   *
   * This row also carried `name`, `emergency` and `lat` from aec9295
   * (2026-08-28) to 2026-09-23, and they went out exactly the way they were
   * written to. At 2026-08-28T09:46:29Z
   * (rev 2537351572) Q55 "Netherlands"'s own `P297 = "NL"` statement was
   * promoted from deprecated to normal rank, so `?c wdt:P297 ?country`
   * matched BOTH items, every single-valued picker saw two answers and
   * withheld, and NL fell 9 -> 7 facts, over `COUNTRY_FIELD_LOSS_GRACE`. The
   * three were RESTORATIONS of the values the artifact already carried.
   * At 2026-09-22T00:49:30Z (rev 2548244569) that edit was undone as
   * vandalism: Q55's statement is deprecated again, qualified `P8327 intended
   * subject of deprecated statement: Q29999`. Upstream once more supplies the
   * same three values the rows held, so they went STALE on that night's run,
   * `assertFactsSane` refused the write as designed, and they were deleted.
   * NL's record does not move. If the promotion comes back, the grace check
   * aborts the run again and these three rows are the fix again.
   */
  NL: { currencyCode: 'EUR', currencyName: 'euro' },
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

/**
 * Hand-verified refusals: P37 statements, by country and by Q-id, that the
 * rules would publish and a human has checked are false.
 *
 * A statement like this no longer waits for a total to be noticed. Since
 * 2026-09-24 `assertFactsSane` stops any run in which a country's published
 * list changes, naming the language (scripts/country-facts/languages.mjs), so
 * the night upstream adds one is the night a human hears about it. This table
 * is one of the three answers to that message, with `CURATED_FACTS` and an
 * accepted change.
 *
 * `CURATED_FACTS` cannot do this. It fills a field the rules WITHHELD, and
 * `pickLanguages` withholds nothing when upstream adds a wrong language —
 * the list is multi-valued, so the extra value simply joins it. Nor can
 * `DROPPED_LANGUAGE_ITEMS`: that drops an id from every country, and the id
 * here is French.
 *
 * The same anti-rot pairing as `CURATED_FACTS`, mirrored. `buildFacts` records
 * each refusal that fires; a refusal whose statement upstream no longer
 * carries is STALE and `assertFactsSane` refuses the write, and so does one
 * that would leave its country with no official language at all. A country
 * with NO P37 rows gets no verdict either way — that is what a demoted
 * property looks like, and reading it as "upstream dropped the statement"
 * would turn every P37 outage into a refused write.
 *
 * Staleness only sees the statement GOING. If it is instead strengthened — a
 * real source added, or the country genuinely making the language official —
 * the row keeps firing and nothing here re-examines it. That is the ZW and AZ
 * rows' class: a recorded human judgement, reopened by a human.
 *
 * Why refuse one statement rather than withhold the field, which is this
 * ingest's default answer to a doubtful value: withholding trades a TRUE
 * language, and the packing line it feeds, for silence to avoid one false
 * one. AZ set the precedent — publish the subset the constitution grounds,
 * with the provenance beside it.
 */
export const REFUSED_LANGUAGE_ITEMS = {
  /**
   * French (Q150). At 2026-09-13T23:58:08Z (rev 2545299860) a single edit
   * added it to Q1025 at normal rank, unqualified, its only reference
   * `P143 imported from Wikimedia project: Azerbaijani Wikipedia`. Article 6
   * of Mauritania's constitution (1991, rev. 2012): "The national languages
   * are: Arabic, Poular, Soninke, and Wolof. The official language is
   * Arabic." French, official before 1991, is not named. Measured 2026-09-23
   * by the shipping query: MR's P37 is exactly Arabic (Q13955) and French.
   *
   * It reddened the nightly refresh every day from 2026-09-14 to 09-21 (on
   * 09-22 the stale NL rows above stopped the run first): the ingest took
   * the new value, and the exact 426-language pin in lib/countryTips.test.ts
   * failed the verify step, which withheld the city catalog with it. Taken
   * as given, the record would also have told travellers "Arabic and French
   * are official languages" and lost Mauritania's packing line, which only
   * fires for a single language. This returns MR to the Arabic it shipped.
   * The day upstream deprecates the statement, this row goes stale and the
   * run asks for it back out.
   */
  MR: ['Q150'],
};

