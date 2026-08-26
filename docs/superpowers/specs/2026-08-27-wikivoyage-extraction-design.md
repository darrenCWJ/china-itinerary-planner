# Wikivoyage extraction — design

*Branch `feat/worldwide-cities`. Successor to `2026-08-27-country-guidance-design.md` (T20–T32). Tasks numbered 33–44.*

The committed country-guidance design measured Wikivoyage and refused it (that document, "What no source supplies" and the paragraph beginning *"Wikivoyage is refused, on measured grounds"*). **The user has overridden that refusal and chosen to try extraction anyway.** This document does not re-litigate the decision. It designs the extraction so that the richer, more China-like guidance the user asked for can ship without breaking the honest-gaps rule.

Everything below was measured today, 2026-08-27, against the live MediaWiki API at `https://en.wikivoyage.org/w/api.php` and against a complete offline corpus of **242 country articles** (16,386,799 bytes of wikitext, the same corpus the T20–T32 investigation pulled). Where I quote a rate, I say the denominator. Where I did not measure something, I say so.

---

## 1. What I measured

### 1.1 The API, and which shape to use

**Licence, confirmed live** — `action=query&meta=siteinfo&siprop=rightsinfo`:

```json
{"url":"https://creativecommons.org/licenses/by-sa/4.0/deed.en",
 "text":"Creative Commons Attribution-Share Alike 4.0"}
```

**CC BY-SA 4.0**, not 3.0. This is the same licence family as the Wikipedia extracts the app already credits, which matters a great deal for §6.

**Four endpoint shapes were tested.**

| Shape | Result |
|---|---|
| `action=parse&page=X&prop=sections` | Works. **Deprecated** — the API returns `"prop=sections" has been deprecated. Please use "prop=tocdata"`. |
| `action=parse&page=X&prop=wikitext&section=N` | Works, returns one section. **But `N` is positional and shifts on every edit that adds a heading**, and the returned block *includes all descendant subsections*. |
| `/api/rest_v1/page/summary/X` | Works, but returns only the lead paragraph and page metadata — no section structure at all. Useless here. |
| `/api/rest_v1/page/mobile-sections/X` | **HTTP 403.** Not available. |
| `action=query&prop=revisions&rvprop=content&rvslots=main&titles=A\|B\|C` | **Works, up to 50 titles per request.** Verified with 4 titles → 482,966 bytes, all four articles complete, no warnings, no continuation. |

**Decision: fetch whole articles in batches of titles, split sections locally.** Per-section fetching would cost 242 × (1 section-list call + ~8 section calls) ≈ 2,178 requests and would still need a heading-name lookup to survive index drift. The batch endpoint does the same job in **5 requests** (242 ÷ 50). The whole corpus is 16.4 MB — trivial to hold in memory, and §7's "compute everything, then write once" rule wants it in memory anyway.

**A rate-limit finding that is directly the Task 7 shape.** Under a thin User-Agent I was throttled, and the response was:

```
HTTP 429, Content-Type: text/html, body = 1,964 bytes of "Wikimedia Error" HTML
```

A 429 from this API returns **an HTML error page, not JSON**. A naive `res.ok` check catches it; a naive "did we get bytes?" check sees 1,964 bytes and treats it as an answer. A *missing* page is different again — it returns HTTP 200 with `{"title": "...", "missing": true}` and no `revisions` key. **Three outcomes that must never be conflated: outage (429/5xx/HTML), page-does-not-exist (200 + `missing`), and page-exists-but-has-no-target-section (200 + content, zero candidates).** §7 handles each separately.

### 1.2 The corpus

242 country articles, from the offline pull.

| Metric | Value |
|---|---|
| Articles | 242 |
| Total wikitext | 16,386,799 bytes |
| Mean per article | 67,714 bytes |
| Largest | India, 283,225 bytes |
| Smallest | BQ (Caribbean Netherlands), 380 bytes |

**Quality tier**, from the article's own banner template:

| Tier | Count | Share |
|---|---|---|
| `{{outlinecountry}}` | 140 | 57.9% |
| `{{usablecountry}}` | 60 | 24.8% |
| `{{guidecountry}}` | 5 | 2.1% |
| `{{starcountry}}` | 1 | 0.4% |
| no banner | 36 | 14.9% |

This independently reproduces the 57.9% outline figure quoted in the predecessor document. **Fewer than 3% of country articles are `guide` or `star`.**

### 1.3 How consistent is the section structure, really

Consistent at the top level, **wildly inconsistent below it**. Wikivoyage's country template prescribes `Understand / Talk / Get in / Get around / See / Do / Buy / Eat / Drink / Sleep / Learn / Work / Stay safe / Stay healthy / Respect / Connect`, and articles do largely follow it. Peru has all of them.

The problem is what sits *inside* a top-level section, and it is the opposite of what I expected:

**On well-developed articles, the top-level section frequently has no prose of its own at all.** Peru's `==Buy==` is immediately followed by `===Money===`; its `==Get around==` is immediately followed by `===Times and distances===`. Extracting "the lead of the Buy section" for Peru yields **zero bytes**. Peru's Buy subtree, by contrast, runs to ATM fee tables, six named banks, and per-bank withdrawal limits dated "(Feb 2018)".

So the richer the article, the emptier its section leads; and the thinner the article, the more its section lead is all there is — but thin articles are thin. This is a real inversion and it caps the yield.

### 1.4 What the target sections actually contain

Verbatim, from the live API.

**Peru `==Connect==`** — the entire section lead, which is what a "Connect" extraction would draw on:

> In all but the smallest towns and villages, one can find public telephones for national and international calls. Most are in bars or stores. […] You also can buy phone cards with a 12-digit secret number on it. Using a phone card, first dial 147. […] Internet cafés, called in Peru cabinas públicas, grow like mushrooms in Peru […] you can still find Internet cafés with 512kbit/s ADSL. […] It is not uncommon to find cabinas that burn CDs directly from SD, CF or Memory sticks.

This is the single most important finding in the document. The user's goal is Alipay/VPN/12306-class advice. **Peru's Connect section — the section that would carry exactly that — is roughly 2008-vintage and describes a country that no longer exists.** It is verbatim, correctly attributed, structurally clean, complete sentences with no markup. Every principle except truth is satisfied. Shipping it would be worse than shipping nothing, because it looks researched.

Staleness is unevenly distributed and it is *not* predicted by the quality tier. Chad's Connect section says *"A number of eSIM providers have products for Chad"* — current and genuinely useful. Czechia's says *"Czech phones operate on the GSM standard"* — a network being switched off worldwide.

**Peru `==Buy==` lead: empty.** The first prose is under `===Money===` and begins with an `{{exchange rates}}` template carrying `USD=3.4 | EUR=3.9 | date=August 2026`, then *"The currency of Peru is the sol (ISO code: PEN)"* — which is the one fact Wikidata already supplies at 99.2% coverage.

**Japan `==Stay safe==`** contains `交番`, `警察署`, `110番`. This collides with a contract the project already has: T21, T27 and T30 all scan generated output for any codepoint in `[一-鿿]` and fail on a match. Extracted Japanese prose would redden the project's own anti-leak test. That test cannot simply be relaxed, because catching Chinese leakage is its entire purpose.

### 1.5 The measurement

I ran a strict structural gate (§3) over the section leads of eight target sections — `Buy`, `Connect`, `Get around`, `Stay safe`, `Get in`, `Stay healthy`, `Respect`, `Talk` — across **all 242 articles**.

```
countries                  242
candidate sentences     17,093
survived the gate        1,321
survival rate             7.73%
countries yielding >=1     228 / 242  (94.2%)
sentences per country    min 0, median 5, max 18
```

**Per section**, sorted by survival:

| Section | Candidates | Survived | Rate | Countries covered |
|---|---|---|---|---|
| Stay healthy | 2,369 | 280 | 11.8% | 127 |
| Stay safe | 2,517 | 277 | 11.0% | 135 |
| Get around | 798 | 83 | 10.4% | 46 |
| Respect | 2,360 | 205 | 8.7% | 104 |
| Connect | 2,038 | 166 | 8.1% | 98 |
| Get in | 2,003 | 131 | 6.5% | 84 |
| Talk | 2,658 | 105 | 4.0% | 81 |
| Buy | 2,350 | 74 | 3.1% | 50 |

**Why each rule fires**, as a share of all 17,093 candidates:

| Rejection reason | Count | Share |
|---|---|---|
| anaphora | 2,445 | 14.3% |
| quotation mark present | 1,688 | 9.9% |
| discourse opener | 1,621 | 9.5% |
| contains a digit | 1,603 | 9.4% |
| too short (<45 chars) | 1,503 | 8.8% |
| too long (>200 chars) | 1,414 | 8.3% |
| unvetted proper noun | 948 | 5.5% |
| parenthetical | 787 | 4.6% |
| colon or semicolon | 762 | 4.5% |
| too few words (<9) | 697 | 4.1% |
| opinion or hedge | 676 | 4.0% |
| markup residue | 267 | 1.6% |
| internal sentence break | 209 | 1.2% |
| non-Latin script | 172 | 1.0% |
| fact-layer topic (currency) | 162 | 0.9% |
| sensitive topic | 161 | 0.9% |
| definite anaphor | 49 | 0.3% |
| stale technology | 36 | 0.2% |

### 1.6 The number that actually decides the design

**Survival rate is the wrong metric. Precision among survivors is the right one.** I drew a deterministic pseudo-random sample of **50 of the 1,321 survivors** and classified every one by hand:

| Verdict | Count | Share |
|---|---|---|
| Genuinely shippable | 33 | 66% |
| True but vacuous | 3 | 6% |
| **Defective** | **14** | **28%** |

**Roughly one in four sentences that pass every structural check is still defective.** Effective yield of genuinely useful sentences is therefore `7.73% × 66% ≈ 5.1%` of candidates — about 870 sentences, ~3.6 per country.

**Good survivors** — these are real, and they are the reason the user's instinct was not wrong:

> *(Turkmenistan / Connect)* Internet services are heavily monitored and censored in Turkmenistan.
> *(Belgium / Respect)* Giving tips in bars or restaurants is virtually unheard of, even in larger cities.
> *(Algeria / Buy)* You will struggle to exchange currencies other than US dollars and euros, and the money changers tend to be picky about accepting ripped and older bills, so ensure your bills are crisp and clean.
> *(Qatar / Respect)* Business cards should always be given and received using only your right hand.
> *(Tunisia / Connect)* Ask for a carte prépayée for a prepaid SIM card.
> *(Chad / Connect)* A number of eSIM providers have products for Chad.
> *(Mauritania / Get around)* Make sure to have plenty of passport copies for travelling between towns.
> *(Turkmenistan / Get in)* Do not bring material critical of the country or the government, or pornographic materials into the country.
> *(North Korea / Get around)* All your transport needs will be dealt with by your tour company.
> *(Burkina Faso / Stay healthy)* Yellow fever vaccination is required in order to enter the country.

That Turkmenistan line is *precisely* the VPN-class advice the user asked for. So is the Algeria line. This is the case for doing the work.

**Defective survivors**, all of which passed every structural check:

> *(Switzerland / Stay safe)* The same applies to you if you witness anyone in danger.
> — **dangling reference.** Meaningless alone.

> *(Japan / Stay healthy)* The main reservoir of the virus is pigs, so vaccination is unnecessary unless you plan on spending time at rural hog farms.
> — **dangling reference.** "The virus" is Japanese encephalitis, named in the previous sentence.

> *(Italy / Connect)* In case of emergency call the appropriate number from the list below.
> — **dangling cross-reference to a list we are not shipping.**

> *(Hong Kong / Connect)* A copy of your identity document or passport is also needed for registration.
> — **dangling.** Registration of a SIM card, established two sentences earlier.

> *(Peru / Stay healthy)* Consider wearing long sleeves and read Pests#Mosquitoes for other useful advice.
> — **markup residue that survives stripping.** `[[Pests#Mosquitoes]]` becomes bare text with no brackets left to detect.

> *(Liberia / Connect)* So when you arrive, visiting or staying, you need a GSM mobile phone.
> *(Czechia / Connect)* Czech phones operate on the GSM standard, which covers practically all of the country.
> — **stale technology** that no keyword list reliably anticipates.

> *(Costa Rica / Respect)* The most common clothes are long pants and collared, but informal, shirts of muted colors.
> — **garbled in the source.**

> *(Guinea / Stay safe)* Low salaries and improper training contribute to the lack of professionalism of the police.
> — **editorial judgement about a country's institutions.** Not something this app should assert.

> *(Finland / Respect)* During the wet season you can ask to put your shoes somewhere to dry during your stay.
> — Finland has no wet season. Mis-sectioned or garbled upstream.

> *(Peru / Stay safe)* Dial 911 for all emergency services, but dialing the old 105 can also connect you with the police.
> — **directly contradicts the Wikidata fact layer**, which T26 renders as *"Emergency numbers: 105 police, 116 fire, 106 ambulance."* A live, measured instance of the principle-4 conflict case, on the flagship country.

**The dominant residual defect is dangling definite reference, and it is semantic, not structural.** "The same applies to you if you witness anyone in danger" is a grammatically perfect, complete, markup-free, opinion-free, digit-free English sentence. No hand-rolled regex gate distinguishes it from "Business cards should always be given and received using only your right hand." I tried: adding explicit definite-anaphor rules moved the needle by 49 sentences out of 17,093.

**This single fact determines the architecture in §3.5.** No purely automatic gate gets the defect rate below roughly a quarter. So the gate cannot be the last line of defence.

---

## 2. What is extractable, honestly

**Per section, what survives and what it is worth.**

**`Stay healthy` (11.8%, 127 countries) — the best section, and the least interesting.** High survival because the register is imperative and self-contained: "Wear long sleeves and long trousers and apply an effective insect repellent." Genuinely useful, but it is generic travel-health advice, not local knowledge. It is the section least like the China tips.

**`Stay safe` (11.0%, 135 countries) — the widest coverage, and the most dangerous.** Survivors split between the useful (*"Keep backpacks and purses with you at all times"*) and the alarming-and-editorial (*"Somali government forces have also launched artillery attacks…"*, *"Armed men may pose a threat to women in some areas"*). A trip planner that tells a user about artillery is making an editorial choice it has not thought about. §3.4 rejects conflict reporting outright, which is why this section's rate fell from 11.7% to 11.0% in the final gate.

**`Connect` (8.1%, 98 countries) — the highest-value section, and the most rotten.** This is where Alipay/VPN-class advice lives. It delivers Turkmenistan's censorship note and Chad's eSIM note. It also delivers Peru's internet cafés and Liberia's GSM handsets. **Yield is high in variance and low in reliability, and staleness is not predictable from any signal the article carries.**

**`Respect` (8.7%, 104 countries) — the closest thing to China-like local knowledge.** Tipping norms, dress codes, right-hand etiquette. The best section for the user's actual goal. It also carries the most sensitive material — religion, gender, race — which §3.4 rejects wholesale, at a real cost in coverage.

**`Get around` (10.4%, only 46 countries) — thin coverage.** Only 798 candidates total, because on developed articles this section is all subsections (Peru: zero-byte lead).

**`Get in` (6.5%, 84 countries) — mostly visa prose, and mostly nationality-dependent.** *"Citizens of many countries can visit the country without a visa"* is vacuous; *"Saudi citizens are only eligible for the single-entry visa-on-arrival"* is useless to a user whose passport we do not know. The predecessor design already refused visa rules for this reason and it was right.

**`Talk` (4.0%, 81 countries) — low yield, and duplicative.** Survivors are mostly "English is widely spoken", which is useful, but the official-language fact already comes from Wikidata P37 at 243/246.

**`Buy` (3.1%, only 50 countries) — the worst section, by design.** It collapsed from 6.9% once §3.3's fact-layer exclusion removed anything naming a currency. That is correct behaviour: Buy's country-level content *is* the currency, and Wikidata already supplies it certainly. **The predecessor design's claim that "the one section that extracts cleanly is Buy — which yields the field Wikidata already gives" is confirmed, and this design deliberately gives that section up.**

### The honest summary

> Extraction yields roughly **5% of candidate sentences as genuinely useful country-level advice** — about 870 sentences across 228 of 242 countries, a median of 3–4 per country. The two sections that carry China-like local knowledge, **`Connect` and `Respect`, survive at 8.1% and 8.7%**. But **28% of everything that passes a strict structural gate is still defective**, and the dominant defect — a sentence that reads perfectly but refers to a sentence we are not shipping — cannot be caught structurally. Fully automatic extraction cannot meet this project's honesty bar. Extraction plus a one-time human review pass can, comfortably.

---

## 3. The gate

Implemented as a pure exported function in `scripts/ingest-wikivoyage.mjs`, one rule per line, each returning a named reason so the report and the tests can count them. Node built-ins only; no dependency. Rules run in the listed order and the first failure wins, so the histogram in §1.5 is a partition, not overlapping counts.

### 3.0 Before the gate: extraction that does not manufacture defects

Two defects in my first prototype were *created by the extractor*, not present upstream. Both are fixed by construction rather than by a rule.

**Never join lines within a paragraph.** Wikivoyage uses bold pseudo-headings on their own line (`'''Food safety'''`). Joining a paragraph's lines merges the heading into the next sentence and produces *"Food safety Enjoy the food, but be judicious…"*. In one Peru section this corrupted **7 of 19** otherwise-passing sentences. **Rule: each physical line is split independently; lines are never concatenated.** A bare pseudo-heading line then fails `no-terminator` and `too-short` on its own, which is correct.

**Only take section leads, and drop non-prose lines entirely rather than salvaging them.** Any line starting `*`, `#`, `:`, `;`, `|`, `!`, `{{`, `}}`, `{|`, `|}`, `[[File:`, `[[Image:`, `[[Category:` or `<!--` is discarded whole. Templates are never partially parsed — an `{{exchange rates}}` block is not a source of sentences.

**Section resolution is by heading name, never by index.** `action=parse&section=N` indices shift whenever an editor adds a heading. Sections are found by matching the heading text against a fixed allowlist.

### 3.1 Structural well-formedness

| Rule | Rejects | Why |
|---|---|---|
| length 45–200 chars | fragments; walls of text | Below 45 is a caption or heading; above 200 is a multi-clause paragraph that will not read as a tip. |
| 9–34 words | same, in the other unit | Catches long strings of short words and short strings of long ones. |
| starts `[A-Z]` | mid-sentence fragments | A sentence that starts lowercase was cut from somewhere. |
| ends `[.!?]` | truncation | |
| no `[.!?]` followed by space | multi-sentence blobs | The splitter can fail on abbreviations; this catches its failures rather than trusting it. |
| no `{ } [ ] \| < > = & ~ ^ \_` or `''` | markup residue | Direct residue check. 267 hits (1.6%). |
| **no `#`** | `Pests#Mosquitoes` | **Wikilink fragments survive bracket-stripping.** This rule exists because I shipped one in a prototype. |
| no codepoint outside Latin-1 + Latin Extended-A/B | CJK, Cyrillic, Arabic, Thai, Greek | 172 hits (1.0%). **Also protects the project's existing `[一-鿿]` anti-leak contract in T21/T27/T30**, which extracted Japanese prose would otherwise redden. |
| no `"` `'` `‘` `’` `“` `”` | glossary entries, quoted slang | 1,688 hits (9.9%) — the second-largest single rule. Wikivoyage's Talk sections are full of `Tombo means "policeman"`. |
| no `(` or `)` | parenthetical asides | 787 hits. Parentheses almost always carry a gloss, a date, or a native-script term. |
| no `:` or `;` | list lead-ins | 762 hits. A trailing colon introduces a list we are not shipping; an internal one is usually a definition. |
| no ` - `, ` -- `, `—` | em-dash asides | Same reasoning, weaker signal. |

### 3.2 Self-containment — the section-scoped promise

A sentence ships out of its paragraph. Anything that points outside itself must go.

| Rule | Rejects |
|---|---|
| **anaphora anywhere**: `it its this that these those they them their there he him his she her such another others former latter here` | 2,445 hits (14.3%) — **the largest single rule.** |
| **discourse opener**: sentence begins `However\|Also\|But\|And\|Then\|Additionally\|Furthermore\|Moreover\|Otherwise\|Instead\|Nevertheless\|Besides\|Alternatively\|Conversely\|Thus\|Hence\|Therefore\|Similarly\|Likewise\|Meanwhile\|Again\|Finally\|First\|Second\|Third\|Note\|Although\|While\|Since\|Because\|If\|When\|As\|For\|In addition\|On the other hand\|That said\|Most\|Some\|Many\|Both\|Either\|Neither\|Once\|Unlike\|Despite\|Apart` | 1,621 hits (9.5%) |
| **mid-sentence discourse**: `indeed\|in fact\|of course\|after all\|for instance\|for example` | catches *"Indeed, all hotels … will accept the US dollar."* |
| **trailing connective**: ends `however.\|though.\|too.\|as well.\|instead.\|either.` | catches *"Switzerland is not a member of the EU, however."* |
| **definite anaphor**: `the same\|the former\|the latter\|the other\|the nearest\|the above\|alternative(ly)`, or begins `The (same\|former\|latter\|main\|other\|above\|following\|informal\|formal\|first\|second)` | 49 hits. **Weak — this is the rule that cannot be completed.** See §3.5. |
| **explicit cross-reference**: `see above\|see below\|as mentioned\|as noted\|as described\|see the section\|section\|article\|previous\|following\|aforementioned\|listed below\|above` | 50 hits |
| **unvetted proper noun**: any mid-sentence `[A-Z][a-z]{2,}` token not in `{country name, its adjectival forms, "English"}` | 948 hits (5.5%). Kills brand names (`Scotiabank`, `Tottus`), institutions (`Ministry of Foreign Affairs`), and — critically — **city names**, which is how "no city-specific detail masquerading as country advice" is enforced. It is a blunt rule that costs real coverage, and that trade is deliberate. |

### 3.3 Never contradict a fact — principle 4, made structural

The predecessor design's fact layer owns currency, plug types, voltage, driving side, dialling code, emergency numbers and official languages. Extraction must never displace or contradict it. Rather than trying to *detect* contradiction, **the gate forbids extraction from speaking about those topics at all.**

| Rule | Rejects |
|---|---|
| **no digit anywhere** | 1,603 hits (9.4%). Removes prices, years, ATM limits, distances, phone numbers, voltages and emergency numbers in one rule. It is why *"Dial 911 … the old 105"* cannot reach a user. |
| currency vocabulary: `currency\|banknote\|coin\|denomination\|sol\|euro\|dollar\|pound\|yen\|rupee\|peso\|baht\|dinar\|franc\|rial\|riyal\|krone\|zloty\|lira\|ruble\|shilling\|dirham\|real\|reais\|cash\|ATM` | 162 hits. Catches *"Calling the USA costs about one real per minute"*, where the amount is spelled out and the digit rule misses. |
| electricity: `socket\|plug\|voltage\|volt\|adapter\|outlet\|mains\|hertz` | |
| dialling: `emergency number\|police number\|ambulance\|fire brigade\|dial\|dialling\|country code\|area code\|calling code` | |
| driving: `drives on the\|left-hand traffic\|right-hand traffic\|left-hand side\|right-hand side` | |
| language: `official language(s)` | 54 hits |

**A conflict between the layers is therefore not resolved at render time — it is made unrepresentable at build time.** This costs `Buy` more than half its yield (6.9% → 3.1%) and that is the correct price.

### 3.4 Editorial safety

| Rule | Rejects |
|---|---|
| **opinion and hedge**: `amazing\|awesome\|stunning\|breathtaking\|beautiful\|charming\|lovely\|wonderful\|horrible\|terrible\|awful\|nasty\|disgusting\|worst\|best\|recommend\|frankly\|sadly\|unfortunately\|thankfully\|luckily\|obviously\|arguably\|probably\|perhaps\|maybe\|seems\|apparently\|reportedly\|allegedly\|surprisingly\|famously\|notoriously\|quite\|rather\|fairly\|pretty\|very\|extremely\|incredibly\|somewhat\|generally\|usually\|often\|sometimes\|rarely\|typically\|normally\|mostly` | 676 hits. Deliberately over-broad: hedged advice is unfalsifiable advice. |
| **first or second person editorial**: `I\|I'm\|I've\|we\|we'll\|we've\|our\|us\|my\|me` | Wikivoyage prose slips into the first person. (`you`/`your` are allowed — imperative travel advice needs them.) |
| **sensitive topic**: drugs, sex work, racial and ethnic slurs, sexuality, abortion, religion, alcohol and tobacco, named diseases | 161 hits. Peru's Respect section otherwise ships coca-leaf advocacy (*"You can try them to experience the culture"*) and a passage about racial slurs. **Neither belongs in a generated itinerary under any licence.** |
| **conflict reporting**: `insurgen\|militia\|artillery\|casualt\|unrest\|protest\|riot\|civil war\|militar\|banditry\|armed` | Somalia's artillery sentence. A trip planner does not report on wars. |
| **stale technology**: `internet caf\|cyber caf\|phone card\|calling card\|payphone\|public telephone\|telephone booth\|fax\|traveller's cheque\|dial-up\|ADSL\|CD-R\|floppy\|memory stick\|GPRS\|WAP\|landline\|kiosk\|telegram office\|poste restante` | 36 hits. **Note the plural trap**: `\bphone card\b` does not match "phone cards" — the boundary sits between `d` and `s`. My first prototype shipped seven Peru telephone sentences because of exactly this. Every multi-word term must be anchored only at its left edge. |
| promo / URL | 4 hits. Near-zero, kept because it is free. |

### 3.5 The rule that cannot be written — and what replaces it

Everything above is implementable in a hundred lines of hand-rolled regex with no dependency, and it takes 17,093 candidates down to 1,321. **It does not get the defect rate below 28%,** because the residue is semantic.

So the gate's output is **not shipped**. It is a *proposal*.

```
Wikivoyage  ──gate──▶  candidates (1,321)  ──human review──▶  approved allowlist  ──▶  shipped
                        uncommitted                            committed TypeScript      data/*.json
```

**`lib/wikivoyageApproved.ts` is a committed, hand-reviewed allowlist**: a zero-import leaf exporting a frozen array of `{ hash, code, section, text, revid }`. A candidate ships **only** if its content hash appears there.

This is not a hedge. It is the only mechanism that satisfies the user's choice *and* the honesty rule at the same time, and it is cheap: **1,321 sentences is one reviewing session.** At three seconds each — and most are obvious in one — that is about an hour of human attention, once. The predecessor design already accepts a human editorial layer for exactly this class of content (`lib/countryData/cn.ts`, described there as *"permanent, not transitional"*). This is that layer, generalised, with a machine doing the reading.

Three consequences fall out of it, all good:

- **Byte-stability is by construction.** The shipped artifact is a function of the allowlist, not of upstream. Wikivoyage sees edits most days; the artifact changes only when a human changes the allowlist. §7 covers what happens when upstream diverges.
- **Verbatim is enforced mechanically.** The hash is over the exact approved bytes. Anything not byte-identical to what a human read cannot ship.
- **The review is the audit trail.** Principle 7 asks for a report a person can spot-check before it ships. Here, the person spot-checking *is* the gate.

---

## 4. How it layers on the facts

### 4.1 Where the sentences appear

`CountryProfile` (as extended by T27) gains one field:

```ts
/** Verbatim Wikivoyage sentences, human-approved. Never generated, never paraphrased. */
guidanceNotes: ReadonlyArray<{ section: string; text: string }>;
```

Rendering order in the tips panel, top to bottom:

1. **Neutral tips** — the app's own copy (`NEUTRAL_TIPS`).
2. **Fact-derived tips** — the app's own sentences, from Wikidata scalars via T26's fixed templates.
3. **— visual break —**
4. **"Notes from Wikivoyage"** — a distinct block, each sentence a separate item, each shown as a quotation, with the section it came from as a label and the CC BY-SA credit beneath.
5. **Gap note** — muted, structurally not a tip (§5).

**The break at (3) is load-bearing three times over.** It keeps fact-derived certainty visually separate from best-effort prose, so a user can tell which is which. It marks the boundary between the app's own copy and third-party CC BY-SA material, which §6 needs. And it prevents extracted sentences from being read as things the app is asserting.

`guidanceNotes` is **never** merged into `plan.tips`. `plan.tips` is snapshotted at trip creation and never regenerated (`planService.ts:13`); guidance notes are computed at render time from the trip's country, exactly like `gapNote` and for the same reason given in the predecessor design — they are a statement about our current data, and they must be able to improve or disappear without a persisted-shape migration.

### 4.2 How a conflict is resolved

**It cannot arise.** §3.3 forbids extracted sentences from mentioning any topic the fact layer owns. There is no precedence rule because there is no overlap.

Two defences keep it that way as the fact layer grows:

- **A derived contract test.** For every country in the shipped artifact, no `guidanceNotes` entry may contain a digit, or any term from the fact-layer vocabulary lists. The lists live in one exported const shared by the gate and the test, so adding a fact-layer field extends both at once.
- **A cross-layer test.** For a fixture set of countries, assert that no approved sentence contains that country's `currencyCode`, currency name, any of its emergency numbers, its dialling code, or its plug letters. This is the *positive* form of the same guarantee and it would catch a vocabulary list that drifted out of sync.

If a future task adds a fact-layer field whose topic overlaps existing approved sentences, those sentences fail the contract test and the build goes red until a human removes them from the allowlist. **The fact layer always wins, and it wins at build time.**

---

## 5. The honest-gap interaction

The predecessor design's gap note line 1 is:

> These notes come from open reference data. We don't have Peru-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.

**This becomes wrong the moment extraction succeeds.** If Peru gains a `Connect` note, the app is simultaneously showing connectivity guidance and stating it has none. That is a worse honesty failure than the one this project set out to fix, and it is the sort of defect this repo's history says will live in the plan rather than the implementation.

**So the gap note's topic list must be derived, never hardcoded.** The topic clause is computed from what is actually present for that country:

```
GUIDANCE_TOPICS = {
  payments:      "payments",           // present iff an approved `Buy` note exists
  connectivity:  "connectivity",       // ... `Connect`
  gettingAround: "getting around",     // ... `Get around`
  safety:        "staying safe",       // ... `Stay safe`
  etiquette:     "local etiquette",    // ... `Respect`
}
```

A topic is named in the gap note **only if the country has no approved note for it**. Public holidays stay in the list unconditionally — no source supplies them, per the predecessor design.

**What each country sees.**

- **A country with no approved notes at all** (14 of 242 yield nothing even before review): the note is exactly as the predecessor design specifies. Extraction is invisible. **This is the required default and the artifact being absent must produce it** — a country missing from the artifact and a country present with an empty array must both take this path.
- **Peru, with an approved `Stay safe` and `Stay healthy` note but nothing for Buy or Connect:**
  > These notes come from open reference data. We don't have Peru-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.
- **A country with approved `Connect` and `Respect` notes:**
  > These notes come from open reference data. We don't have Andorra-specific guidance on payments, booking channels or public holidays yet — and we'd rather leave that blank than guess.

Line 2 (the absent-fact-fields line) is unchanged and unaffected — it is about Wikidata facts, not prose.

**China's `gapNote` stays `[]` and China gets no `guidanceNotes`.** `lib/countryData/cn.ts` remains the hand-written editorial layer. Extraction never runs for CN, and a test asserts CN's `guidanceNotes` is empty — which also keeps CN's byte-identical output guarantee (`countryProfile.test.ts:17-33`) intact.

**Silence is still the default.** If the artifact fails to load, if the allowlist is empty, if a country is absent — every path produces zero notes and the unmodified gap note. There is no placeholder sentence, no hedge, and no "guidance coming soon".

---

## 6. Attribution

### 6.1 What is required

Wikivoyage is **CC BY-SA 4.0** (confirmed live, §1.1). That is the *same licence* the app already discharges for Wikipedia extracts. The existing credit reads, in full:

> City data from **GeoNames** — a filtered, modified subset — used under **CC BY 4.0**. Descriptions adapted from **Wikipedia** — shortened intro extracts — used under **CC BY-SA 4.0**; some are short public-domain summaries instead, which carry no attribution condition.

CC BY-SA 4.0 requires attribution, a licence link, and an indication of modification. It also carries share-alike on *adapted* material — see §6.4.

### 6.2 The decision: extend `GeoNamesCredit`, do not add a component

`lib/contracts.test.ts` (C7) hardcodes `rendersCredit` to the literal string `"<GeoNamesCredit"` (`:666`) and the import specifier `"@/components/plan/GeoNamesCredit"` (`:1041`). **A differently-named credit component is invisible to the entire C7 machinery** — including the both-directions equality at `:988` that makes the report's surface list and the derived set identical. A second component would therefore be able to go missing from a surface without any test noticing, which is the exact failure C7 exists to prevent.

So Wikivoyage joins the existing component as a third clause.

**All three guidance surfaces are already transitively covered**, verified against the crediting set:

| Guidance surface (T28/T40) | Rendered inside | Renders `GeoNamesCredit` |
|---|---|---|
| `components/PlanStep.tsx` | `app/plan/page.tsx` | ✅ (C7 allowlist entry, `coveredBy: app/plan/page.tsx`) |
| `components/trip/PlanTab.tsx` | `components/TripView.tsx` | ✅ (`:171`, `:347`) |
| `components/trip/BriefingView.tsx` | `app/b/[code]/page.tsx` | ✅ (`:45`) |

**No new crediting surface is added, so `reportedSurfaces()` and the `- \`path\`` bullet list in `data/cities-report.md` are unchanged.** This matters: that regex (`/^- \`([^\`]+)\`/gm`, `:707`) parses *any* line-initial backticked-path bullet in the Attribution section as a claimed surface, and the claim is asserted equal to the derived set in both directions. **Any new bullet added there must be a file that genuinely renders the credit.**

### 6.3 The eight coupled changes, which land in one commit (T41)

1. **`components/plan/GeoNamesCredit.tsx`** — a third clause. Wikivoyage gets **its own deed link** and **its own modification word**, because `GeoNamesCredit.test.tsx:95-129` requires a modification word between each source name and its own link, matching `/\b(?:modified|adapted|filtered|shortened|abridged|subset|excerpt)/i`. Sharing Wikipedia's link would not satisfy "its own". Proposed: *"Country notes excerpted verbatim from Wikivoyage — selected individual sentences — used under CC BY-SA 4.0."* Two links to the same deed URL is fine.
2. **The doc-comment** in that file, which currently enumerates the sources that ship and argues why Wikidata is excluded. It gains the Wikivoyage paragraph and the §6.4 collection/adaptation reasoning.
3. **`components/plan/GeoNamesCredit.test.tsx`** — the ordering pin at `:83-85` (`GeoNames < CC BY 4.0 < Wikipedia < CC BY-SA 4.0`) is extended; the `:150` pin (`CC BY-SA 4.0` before the public-domain phrase) must be re-checked against the new clause order. The forbidden-name list at `:188` (`Wikidata`, `Wikimedia`, `Commons`, `OpenStreetMap`) is **unchanged** — Wikivoyage was never in it.
4. **C7's "credit names both licences"** (`:911-922`) — four `toContain` URL assertions become five, or the test is restated as "names every licence it uses". Prefer the latter, derived from a const.
5. **`scripts/ingest-cities.mjs` `buildReport`** (`:876-903`) **and `data/cities-report.md`, in lockstep** — C7 `:1007-1034` re-runs `buildReport` and byte-compares the Attribution section. Changing one without the other is an immediate red. The bullet list is not touched; only the prose above it.
6. **`CITY_NAME_TOKENS`** (`:648-653`) gains a token that identifies files carrying guidance prose (`/\bguidanceNotes\b/`). This makes any future `.tsx` under `app/` or `components/` that renders guidance either credit it or take an explicit allowlist entry — reusing the whole existing derivation rather than building a parallel one. **Expected effect on `CANDIDATES` must be measured, not assumed**, since the arming floor at `:722` is `>= 6` and the allowlist honesty test at `:779-800` will demand a real `coveredBy` for anything new.
7. **The `/every surface/i` ban** (`:975`) applies to the full text of `data/cities-report.md` and `scripts/ingest-cities.mjs`, comments included. New Wikivoyage prose in either file must avoid that phrase. `data/wikivoyage-report.md` is not scanned by that assertion, but should avoid it anyway.
8. **`data/wikivoyage-report.md`** gets its own `## Attribution` section naming CC BY-SA 4.0, pointing at `GeoNamesCredit.tsx` as the discharging surface, and stating — as `cities-report.md` does — that the report is not itself the credit.

### 6.4 Share-alike, stated as a risk and not resolved

The predecessor design refused Wikivoyage partly because **CC BY-SA's share-alike is viral**, and its concern was real: if the app's generated itinerary copy became an *adaptation* of Wikivoyage text, the whole itinerary would inherit CC BY-SA.

This design's structure is the standard way of limiting that reach, and it is the reason for several choices that otherwise look fussy:

- Sentences are **reproduced verbatim, never paraphrased, never merged into the app's own sentences** — principle 1, which is also the line between a *collection* and an *adaptation*.
- They live in a **separate artifact** (`data/wikivoyage-notes.json`), never inside `data/country-facts.json`.
- They render in a **visually distinct, individually attributed block**, never interleaved with the app's generated tips (§4.1).
- They are **never snapshotted into `plan.tips`**, so no persisted trip record embeds them.

**I am not a lawyer and this design does not settle the question.** What it does is keep the boundary crisp enough that the question is answerable, and record it as a risk the user is accepting knowingly. **If the user wants certainty rather than a defensible structure, the correct action is to ship the fact layer alone (T20–T32) and stop.** That option remains open right up until T40, because nothing before it renders a Wikivoyage sentence.

---

## 7. Failure modes

The predecessor design records Task 7 in full: an HTTP 200 with a short body was treated as a full answer and 2,559 of 5,118 records were deleted in one unattended night at exit 0. Every rule below exists because of a shape that incident, or this investigation, actually produced.

**The structural answer is that this ingest cannot wipe anything, because it does not own the shipped data.** The artifact is a function of `lib/wikivoyageApproved.ts` — a committed TypeScript file that no script writes. A catastrophic upstream failure produces zero candidates and therefore zero *new* proposals; it cannot remove an approved sentence, because approved sentences are pinned by text and revision id, not refetched.

| Failure | Detection | Behaviour |
|---|---|---|
| **Outage** — 429, 5xx, DNS, timeout | `res.ok` is false, or the body does not parse as JSON. The measured 429 returns 1,964 bytes of HTML. | Retry with backoff honouring `Retry-After`, capped by `MAX_RETRY_AFTER_MS`. On exhaustion, **throw**. `run()` aborts before any write. |
| **404 on the API endpoint** | HTTP 404 | **`notFoundIsEmpty: false`**, matching `enrich-cities.mjs:462-468`. A 404 on `/w/api.php` is the endpoint moving, not an empty result. Non-retryable throw. |
| **Page does not exist** | HTTP 200, `{"title": "...", "missing": true}`, no `revisions` | **Not an outage and not an error.** Recorded as `articleMissing` for that country, which contributes zero candidates. Distinguished from the next row by the presence of the `missing` key. |
| **Thin answer** — batch returns fewer pages than titles requested | `pages.length < titles.length` and no `missing` flag to explain the difference | **Throw.** This is the Task 7 shape exactly: a partial answer that looks complete. The count is checked per batch, before merging. |
| **Answer parses but yields nothing** — every article returns, no candidates survive | Candidate count collapses versus the previous run | `assertCandidatesSane` throws on a two-sided band. **A zero-candidate run is never written**, and it cannot affect the shipped artifact regardless. |
| **Markup change** — a template rewrite floods candidates with residue | Per-rule rejection histogram drifts beyond a pinned tolerance; total candidate count leaves its band | Throw. The histogram in §1.5 is committed as expected values with tolerances, so *the gate rejecting differently* is itself a monitored signal — not just the totals. |
| **Upstream text diverges from an approved sentence** | The approved sentence's hash no longer matches any candidate for that country | **Reported, never acted on.** The sentence keeps shipping, because we quoted a specific revision and we cite it (§7.1). The report lists divergences for a human to re-review. |
| **Approved sentence disappears upstream entirely** | Same detection | Same behaviour. A quotation does not stop being a quotation because the source was edited. |
| **The allowlist references a country not in the shard set, or a malformed record** | `assertCandidatesSane` shape checks | Throw before any write. |

**Two things this ingest never does:** it never deletes from `lib/wikivoyageApproved.ts`, and it never adds to it. Both directions are human edits, reviewed like any other TypeScript.

### 7.1 Revision pinning, and why it removes the staleness/churn tension

Every approved sentence carries the `revid` it was read from. The credit links to the permanent revision (`https://en.wikivoyage.org/w/index.php?oldid=<revid>`), not the live page. This is both better CC BY-SA practice — the attribution points at the exact version quoted — and the thing that makes the artifact byte-stable.

**Consequence, stated plainly:** an approved sentence can become stale upstream and keep shipping until a human re-reviews it. Given that 28% of gate survivors are already defective and the fix is human review, adding an *automatic* removal path would be trading a small staleness risk for a large silent-deletion risk. The divergence report is the mitigation.

### 7.2 Why this does not join the nightly job

`refresh-cities.yml` runs nightly, commits what changed, and Vercel deploys it unattended. **The Wikivoyage refresh must not be a step in it**, for two independent reasons:

1. **Nothing it produces can ship without a human.** A nightly run that discovers new candidates cannot act on them. It would burn a workflow slot to write a file nobody reads that night.
2. **It would churn.** Wikivoyage sees edits across 242 country articles most days. A committed candidates file would change nearly every night, and the project constraint is that the artifact must be byte-stable on a quiet day or it commits and redeploys for nothing.

**Instead:** a separate `workflow_dispatch` workflow, optionally on a monthly `schedule`, which writes `data/wikivoyage-candidates.json` and the divergence report **as CI artifacts, not commits**. `data/wikivoyage-candidates.json` is gitignored. The two committed files — `data/wikivoyage-notes.json` and `data/wikivoyage-report.md` — are regenerated only when `lib/wikivoyageApproved.ts` changes, which is a human commit that already runs the full suite.

If someone later wires this into the nightly job anyway, the fail-closed rules above still hold; it will simply do nothing useful most nights.

---

## 8. Task breakdown

Gate for every task: `npx tsc --noEmit`, then `npm test`. T20–T32 are taken; these run T33–T44.

**Conventions inherited and non-negotiable** (verified against the repo today): ingest script tests live in `scripts/*.test.ts` and import exported pure functions from the `.mjs` by relative path with an explicit extension; `vitest.config.mts` runs `lib/**` and `scripts/**` in the `node` project and `components/**/*.test.tsx` in `jsdom`; **no include pattern covers `app/`, so a test placed there would never run**; `lib/contracts.test.ts`'s `isScannable` excludes `*.test.ts(x)`, so test files are invisible to every C7 scan.

---

### T33 — The pure wikitext pipeline. No gate, no network.
**Goal:** wikitext → candidate sentences, deterministically.
**Files:** `scripts/ingest-wikivoyage.mjs` (new), `scripts/ingest-wikivoyage.test.ts` (new).
Header doc-comment in the house shape (what / why / idempotent / aborts-before-writing / licence / usage / Node type-stripping caveat), `// ---` banners in the house order. `node:fs|path|url` only. Exports `sectionsOf`, `leadOf`, `stripMarkup`, `splitSentences`.
`sectionsOf` splits on `/^(={2,6})\s*(.+?)\s*\1$/` and records heading, level and body. `leadOf` returns only the text before the first subheading. `stripMarkup` **discards** non-prose lines whole rather than salvaging them, then unwraps piped and plain wikilinks, external links with labels, bold/italic, refs, HTML and the five named entities. `splitSentences` **never joins across newlines**.
**Test story:** fixtures are real wikitext committed as test data — Peru `Buy` (**asserts an empty lead**, because its first child heading follows immediately), Peru `Stay healthy` (asserts the bold pseudo-headings do **not** produce run-in sentences such as `"Food safety Enjoy the food…"`), Japan `Stay safe` (asserts CJK survives stripping so §3.1's rule has something to reject), a `{{exchange rates}}` block (asserts zero sentences). Plus: heading lookup is by name and a fixture with a heading inserted above the target still resolves.
**Done when:** every function is pure, exported and fixture-tested, and the empty-lead and run-in cases are both pinned.

---

### T34 — The gate.
**Goal:** `gateSentence(text, ctx)` returning `{ ok } | { ok: false, reason }`, implementing every rule in §3.
**Files:** `scripts/ingest-wikivoyage.mjs`, `scripts/ingest-wikivoyage.test.ts`.
Rules in the documented order, first failure wins. Fact-layer vocabulary lists exported as one const for reuse by T39's contract test.
**Test story:** **one test per rule**, each using a real sentence from §1.6 rather than a synthetic one — `"The same applies to you if you witness anyone in danger."` → `definite-anaphor`; `"Consider wearing long sleeves and read Pests#Mosquitoes for other useful advice."` → `wikilink-fragment`; `"Dial 911 for all emergency services, but dialing the old 105 can also connect you with the police."` → `contains-digit`; `"Calling the USA costs about one real per minute."` → `fact-layer-currency`; `"Indeed, all hotels…"` → `discourse-mid`. **Plus the plural trap explicitly**: `"You also can buy phone cards with a 12-digit secret number on it."` must be rejected, proving the stale-tech terms are not right-anchored. **Positive half:** the ten good sentences quoted in §1.6 all return `ok`, or the gate is merely a rejector.
**Done when:** every rule has a rejecting test and a non-rejecting counterpart.

---

### T35 — Candidate build, hashing, and `assertCandidatesSane`. No network.
**Goal:** the throwing gate that runs **before any write**.
**Files:** `scripts/ingest-wikivoyage.mjs`, `scripts/ingest-wikivoyage.test.ts`.
`buildCandidates(corpus)` → `{ code, section, text, hash, revid }[]`. Hash is `createHash('sha256').update(text).digest('hex').slice(0, 16)` over the exact bytes — **text only, so a sentence that moves section or is re-approved after a revision bump keeps its identity.**
`assertCandidatesSane(built, previous)` in this order: two-sided country band (never a bare floor — a floor cannot bound a first run where `previous === null`); required-key fixtures a count cannot see; per-record shape (alpha-2 regex, non-empty, bounded lengths, hash format); **per-rule rejection histogram within pinned tolerances**; **then** `if (!previous) return;` and only then the drift checks. Uses **`enrich-cities.mjs:587-599`'s `readJson` that throws on exists-but-unparseable**, never `ingest-cities.mjs:784`'s swallow.
**Test story:** a test per gate branch. Then a `run()` block driving the real entry point with injected loaders and `vi.mock("node:fs", importOriginal)` replacing **only** `writeFileSync`/`renameSync` with spies, asserting `not.toHaveBeenCalled()` for: a thin batch, a corrupt feed, a zero-candidate run, and an unparseable previous artifact. **No source-position grep test** — `ingest-cities.test.ts:1263-1276` records four mutations that keep one green while a corrupt feed reaches disk.
**Done when:** every branch has a test and the `run()` spy asserts no write on each.

---

### T36 — Network layer and the first real candidate run.
**Goal:** run it against live Wikivoyage; produce the review corpus.
**Files:** `scripts/ingest-wikivoyage.mjs` (fetchers, `run()`), `.gitignore`, `data/wikivoyage-report.md`.
Batched `action=query&prop=revisions&rvprop=content&rvslots=main` at **20 titles per request** (not the 50 maximum — 50 × 67.7 KB averages a 3.4 MB response; 20 keeps it near 1.4 MB), politeness delay, descriptive `User-Agent` **naming the project and a contact**, since a thin UA measurably triggered 429s during this investigation. `notFoundIsEmpty: false`. Explicit handling for the three outcomes in §1.1. `writeFileAtomic` copied from `ingest-cities.mjs:771-782` with the Windows-rename comment. `stampedPayload` from `:832`. Entry guard from `:1085-1091`.
`data/wikivoyage-candidates.json` is **gitignored**. The report is a pure `buildWikivoyageReport(...)`.
**Reconcile against this document:** re-measure candidate count, survival rate, per-section table and rejection histogram with the shipping code. **The figures in §1 came from a research harness; every number that lands in a comment, a constant or the report must be produced by the shipping query.** Note where they differ and why.
**Test story:** `describe.skipIf(!hasAssets)` (`lib/cityShard.test.ts:325` precedent) over the produced candidates: expected country count, ≥1 candidate for a fixture set, hash uniqueness, and **at least one country with zero candidates**, proving gaps are real.
**Done when:** the run is recorded, the report is committed, and every measured constant carries its value and the date it was produced.

---

### T37 — The human review pass.
**Goal:** `lib/wikivoyageApproved.ts` — the reviewed allowlist. **This is a human task; the agent prepares and verifies, it does not approve.**
**Files:** `lib/wikivoyageApproved.ts` (new), `lib/wikivoyageApproved.test.ts` (new).
A zero-import leaf exporting a frozen array of `{ hash, code, section, text, revid }`, sorted by `code` then `section` then `hash` so diffs are readable. Doc-comment states: what approval means, that entries are verbatim, that nothing here was generated, and the cost of adding a country.
The agent's job is to **produce a review worksheet** grouping candidates by country and section with the §1.6 defect classes called out, run every candidate through a **second, independent check** (see below), and pre-flag likely rejects. **A human makes every accept decision.**
Second check, because a gate cannot audit itself: assert every candidate is a byte-exact substring of the fetched article body. **A sentence that is not a verbatim substring of upstream is a construction defect**, and this catches stripping bugs that produce plausible-looking text.
**Test story:** every entry's `hash` matches a recomputed hash of its `text`; every `code` is one of the 246 shard codes; **no entry is `CN`**; every `text` passes `gateSentence`; the array is sorted; no duplicate hashes. Plus an iteration floor, or the sweep passes vacuously on an empty allowlist.
**Done when:** the allowlist is committed, every test is green, and the PR records how many candidates were reviewed and how many accepted.

---

### T38 — The shipping artifact and its typed reader.
**Goal:** `data/wikivoyage-notes.json` and `lib/wikivoyageNotes.ts`.
**Files:** `scripts/ingest-wikivoyage.mjs` (artifact build), `data/wikivoyage-notes.json`, `lib/wikivoyageNotes.ts`, `lib/wikivoyageNotes.test.ts`.
The artifact is `(candidates ∩ allowlist)` keyed by uppercase alpha-2, envelope `{ generatedAt, source, license, revisionBase, countries }`. Because it derives from the allowlist, it is byte-stable unless the allowlist changes.
`lib/wikivoyageNotes.ts` mirrors `lib/countryImagery.ts:1`'s static-import structure, **copies on read** so `countryProfile.test.ts:45-50`'s fresh-object contract survives a shared JSON import, and **drops malformed records rather than repairing them**.
`public/` is not an option — `lib/server/cityIndex.ts:13-24` documents that a `public/` read 500s in a lambda, and `PlanStep.tsx:37-38` generates the preview client-side, so the data must reach the browser too.
**Byte budget, measured today** across all 1,321 pre-review candidates:

| Cap per country | Sentences | Bytes | gzip |
|---|---|---|---|
| 2 | 436 | 48,556 | 16,315 |
| 3 | 615 | 68,770 | 22,682 |
| 4 | 771 | 86,568 | 28,198 |
| 5 | 907 | 101,690 | 32,819 |
| uncapped | 1,321 | 147,322 | 46,950 |

Against `data/country-images.json` at 6,505 bytes (reaches the client fine) and `data/cities-index.json` at 3.65 MB (forbidden from client components). **Recommend a cap of 4 per country and a budget test at 120,000 bytes**, modelled on `lib/cityShard.test.ts:368-375`. Post-review the real figure will be lower; **re-measure and set the constant from the shipping build, do not carry these forward untested.** The gzipped column is measured here and, unlike the predecessor design's artifact, **should be asserted** — it is the number that reaches the user.
**Test story:** `describe.skipIf(!hasAssets)`; byte budget; every record shape-valid; **no country exceeds the cap**; CN absent; copy-on-read returns fresh objects.
**Done when:** the artifact is committed and the budget constant carries a measured value and a date.

---

### T39 — Layer onto `CountryProfile`.
**Goal:** `guidanceNotes` on the profile, populated from the artifact, ordered after fact tips. Nothing rendered yet.
**Files:** `lib/countryProfile.ts`, `lib/countryProfile.test.ts`, `lib/countryTips.ts` (gap-note topic derivation), `lib/countryTips.test.ts`.
Adds `guidanceNotes: ReadonlyArray<{ section: string; text: string }>`, `[]` for CN and for any country absent from the artifact. Rewrites the gap note's topic clause to be **derived from present sections** per §5.
**Test story:** **`countryProfile.test.ts:17-33`'s CN pins pass unchanged** and CN's `guidanceNotes` is `[]`. `:45-50` fresh-object and `:110-115` totality on `["", "   ", "CHN", "🙂", "constructor"]` pass. The gap note for a country with an approved `Connect` note **does not contain the word "connectivity"**, and the same country's note **does** contain "payments" — arming in both directions. The §4.2 cross-layer contract: swept over every country in the artifact, no `guidanceNotes` text contains a digit or any fact-layer vocabulary term, **with the loop's iteration count asserted against a pinned floor**. Separately, for a fixture set, no note contains that country's own currency code, emergency numbers, dialling code or plug letters.
**Done when:** the sweep is armed and the gap-note derivation is proven in both directions.

---

### T40 — Render the notes block.
**Goal:** the quoted block reaches the user, visually distinct from generated tips.
**Files:** `components/PlanStep.tsx`, `components/trip/PlanTab.tsx`, `components/trip/BriefingView.tsx`, plus a small presentational component.
Rendered per §4.1: after fact tips, before the gap note, in its own labelled block, each sentence a quotation with its section label. **Never merged into the tips list element**, never into `plan.tips`.
**Test story:** jsdom render for a country with notes shows them **outside** the tips list; for CN shows nothing; for a country with no notes shows nothing and the tips list is unchanged. **Arming proof:** the same assertion run against a country that does have notes must fail the "shows nothing" form. The block's heading names Wikivoyage.
**Done when:** all three surfaces render it, CN renders none, and both directions are armed.

---

### T41 — Attribution. All eight coupled changes, one commit.
**Goal:** discharge CC BY-SA 4.0 and keep C7 green and meaningful.
**Files:** `components/plan/GeoNamesCredit.tsx`, `components/plan/GeoNamesCredit.test.tsx`, `lib/contracts.test.ts`, `scripts/ingest-cities.mjs`, `data/cities-report.md`, `data/wikivoyage-report.md`.
Exactly the eight items in §6.3. **`scripts/ingest-cities.mjs:876-903` and `data/cities-report.md` must change in the same commit** — C7 `:1007-1034` byte-compares them. **Do not add a `- \`path\`` bullet** to the Attribution section; no new crediting surface exists.
**Test story:** `GeoNamesCredit.test.tsx` gains a Wikivoyage clause test mirroring the Wikipedia one — source name, its own modification word, its own deed link, in that order. C7's byte-compare passes. **Measure and report the effect of the new `CITY_NAME_TOKENS` entry on `CANDIDATES`** before and after; if it pulls in a file, that file gets a credit or a justified allowlist entry with a real `coveredBy`, never a silent exclusion.
**Done when:** C7 is green, the credit renders three sources, and the `CANDIDATES` delta is recorded in the PR.

---

### T42 — The refresh workflow.
**Goal:** a re-review can be produced on demand and fails closed.
**Files:** `.github/workflows/refresh-wikivoyage.yml` (new).
`workflow_dispatch` plus an optional monthly `schedule`. **Not a step in `refresh-cities.yml`**, for the two measured reasons in §7.2. Uploads `data/wikivoyage-candidates.json` and the divergence report as **CI artifacts**; commits nothing. Divergence detection compares each approved hash against current candidates and lists misses.
**Test story:** not automatable. One manual `workflow_dispatch` run recorded, plus a deliberate failure injection (unreachable host) confirming the job goes red, uploads nothing, and commits nothing.
**Done when:** both runs are recorded in the PR.

---

### T43 — The acceptance gate.
**Goal:** prove the whole thing, in both directions.
**Files:** `lib/worldwideGuidance.test.ts` (node), `components/plan/worldwideGuidance.test.tsx` (jsdom).
Extends T30's Peru acceptance test rather than duplicating it. Real Peruvian city from the committed PE shard, real coordinates, real month, `kids > 0`, `season: winter`.
**Negative half:** the serialised plan plus guidance notes contains none of `China, Chinese, Alipay, WeChat, VPN, RMB, ¥, 12306, Trip.com, Amap, Pleco, 高德, high-speed rail, 🚄, 🧧, 🇨🇳`, no codepoint in `[一-鿿]`, **no digit inside any guidance note**, and no `{`, `}`, `[`, `]`, `|` or `#`.
**Positive half:** ≥1 guidance note for a country known to have one, the block is present, the gap note does not name a topic that has a note.
**Arming proof:** the identical scan run against a CN plan **asserts that it fails**, and the "has a guidance note" assertion run against CN asserts CN has none. A scan that silently matches nothing cannot pass.
The jsdom sibling covers the wizard, the trip page and the public briefing at `app/b/[code]/page.tsx`, **because guidance notes reach an unauthenticated surface** via `briefing.ts:182` — and therefore so must the credit.
**Done when:** negative, positive and arming assertions are all green on both files.

---

### T44 — Measured-number audit.
**Goal:** every number added by T33–T43 was produced by running something.
**Files:** `scripts/ingest-wikivoyage.mjs` docstrings, `data/wikivoyage-report.md`, comments across the touched `lib/` files, and **this document**.
A final pass confirming each figure has a run and a date behind it. **This document's §1 figures came from a research harness and must be reconciled against T36's shipping run**; where they differ, this document is corrected rather than quietly left stale. Explicitly re-state what was **not** measured: the post-review approved count and artifact size (unknowable until T37), and whether share-alike reaches the app's own copy (§6.4, a legal question, not a measured one).
**Done when:** the audit is complete and every stale figure in this document is corrected.

---

**Dependencies:** T33 → T34 → T35 → T36 → **T37 (human gate)** → T38 → T39 → T40. T41 after T40. T42 after T36. T43 after T41. T44 last.

**T37 is a hard gate.** Nothing downstream of it can be built speculatively, because the artifact's shape, size and coverage are all functions of what a human approves.

**This project's history says the next defect will live in this plan's prescribed code, not the implementation.** The three most likely homes here are: **the gap note claiming a topic is missing while a note for it renders above** (closed by T39's both-directions test); **the anti-leak sweep passing vacuously** when the artifact fails to load (closed by the iteration floor in T39 and T37); and **a figure in §1 carried into a comment without being re-measured by the shipping code** (closed by T36 and audited by T44).

---

## 9. What I would tell the user

You were right that there is real local knowledge in Wikivoyage, and I found it: *"Internet services are heavily monitored and censored in Turkmenistan"*, *"Giving tips in bars or restaurants is virtually unheard of"* for Belgium, *"the money changers tend to be picky about accepting ripped and older bills, so ensure your bills are crisp and clean"* for Algeria. That is genuinely the same *kind* of thing as the Alipay and VPN tips, and no structured dataset has it. But the honest numbers are harder than I would like. Of 17,093 candidate sentences across all 242 country articles, **7.7% survive a strict structural gate — and when I hand-audited 50 of those survivors, 28% were still defective**: sentences that read perfectly but refer to a sentence we are not shipping ("The main reservoir of the virus is pigs"), advice that rotted a decade ago (Peru's entire "Connect" section is about internet cafés and phone cards), and one Peru line that flatly contradicts the emergency numbers our Wikidata layer publishes. That last defect class is semantic, not structural, so no amount of regex tightening fixes it — I tried, and it moved 49 sentences out of 17,093.

So the design does not ship the gate's output. **The gate proposes about 1,321 sentences; you approve them once, by hand, from a worksheet; only approved sentences ever reach a user.** That is roughly an hour of reading, once, and it is the only way I found to give you what you asked for without breaking the rule that nothing unverified reaches a user. Afterwards you should expect about **three or four extra sentences for a typical country** — best in "Stay safe", "Stay healthy" and "Respect", worst in "Buy" (which I deliberately gutted, because Wikidata already knows the currency and I would rather have no sentence than a contradicting one). It will still not match China. China has five tips of hand-written local knowledge that someone who has been there wrote; a well-covered country will get five fact-derived tips plus three or four quoted sentences, clearly marked as quotations from Wikivoyage rather than as things the app is telling you. That is a real improvement over "honest but thin", and it is a smaller improvement than the word "extraction" makes it sound. One thing worth deciding early: Wikivoyage is CC BY-SA, and although quoting verbatim in a visually separate block is the standard way to keep share-alike from reaching your own itinerary copy, I am not able to settle that question for you — if you want certainty rather than a defensible structure, stopping after the fact layer remains a clean option right up until T40.
