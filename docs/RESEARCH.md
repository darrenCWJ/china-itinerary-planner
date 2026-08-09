# Data Source Research — China Itinerary Planner

Research date: 2026-08-10. All URLs verified via live search/fetch unless noted.

## Category 1: Official / Commercial APIs

| Source | Data offered | Access method | Cost/auth | License/ToS risk | Verdict |
|---|---|---|---|---|---|
| **Trip.com (Ctrip)** | Hotels, flights, **China trains**, cars, attractions & tours (210k+ activity products); strongest mainland China inventory of any international OTA | Affiliate program (deep links, widgets, banners); full B2B API at `developers.trip.com` is **partner-gated** (contact sales, no self-serve keys) | Affiliate: free, up to ~7% commission (also via AWIN/CJ/Rakuten/FlexOffers networks); API: negotiated | Low — official program | **Use affiliate now; apply for partner API once you have traffic.** Signup: <https://www.trip.com/partners/> · Portal: <https://developers.trip.com/> |
| **Klook** | Activities, attraction tickets, theme parks, transport passes — very strong China/Asia coverage | Affiliate program (widgets, search boxes, deep links, some data feeds); Partner API (`klook.gitbook.io/openapi`) gated, 4–12 week integration + certification | Affiliate: free, ~2–8% commission, 30-day cookie (hotels 7-day); API tier: 5–12% | Low — official program | **Best activity-category source for China. Join affiliate now.** Signup: <https://affiliate.klook.com/> · API spec: <https://klook.gitbook.io/openapi> |
| **GetYourGuide** | Tours/activities; **weak mainland China inventory** | Partner API, publicly documented but gated: Basic tier requires **100k monthly visits**; Advanced requires 1M visits + 300 bookings/mo | Free to apply; commission-based | Low | **Skip** — traffic floor you won't meet at launch, and thin China inventory. Docs: <https://code.getyourguide.com/partner-api-spec/> |
| **Amadeus Self-Service (POI / Tours & Activities APIs)** | Was: POIs, activities per city | ~~Self-serve REST API~~ — **portal decommissioned 17 July 2026; all self-service API keys disabled**. POI API was deprecated even earlier | n/a | n/a | **Dead end as of July 2026. Do not build on it.** |
| **AMap / Gaode (高德) — direct** | Best-in-class mainland China POI DB (search, around-search, categories, ratings), geocoding, routing, transit | Web Service REST API at `lbs.amap.com` | Free quota for verified devs; **real-name verification: individuals need Chinese ID + Alipay; enterprises need Chinese business license. Console/docs Chinese-only** | Medium — practically closed to foreign developers directly | **Not directly registrable for foreigners — use the Alibaba Cloud route below.** <https://lbs.amap.com/> |
| **AMap via Alibaba Cloud Marketplace** ★ | AMap Places/POI search, autocomplete, geocoding, district lookup, routing, route matrix, JS maps, timezone | REST API resold internationally: <https://www.alibabacloud.com/en/marketplace/amap> | **10,000 free calls/month per SKU**, then tiered (~$0.105–0.19 per 1,000 calls at volume); normal Alibaba Cloud intl. account, no Chinese ID | Low — official reseller channel | **Best legitimate route to authoritative China POI data for a foreign developer.** Caveat: returns **GCJ-02 coordinates** — convert (e.g. `eviltransform`) before plotting on WGS-84 maps like Leaflet/OSM |
| **Baidu Maps API** | China POI, geocoding, routing (BD-09 coords) | REST API at `lbs.baidu.com` | Individual accounts **Chinese citizens only** (ID + selfie); enterprise needs **Chinese business license + phone**; docs Chinese-only | High friction, effectively closed | **Avoid.** AMap-via-Alibaba covers the same need |
| **Google Places API** | Global POI | REST API, self-serve | $200/mo credit then pay-per-call | Low ToS risk, but **mainland China data is sparse, stale, and English-biased**; Chinese surveying law bars Google from local map operations | **Not viable as primary China POI source.** Fallback for airports/intl. hotel chains only |

## Category 2: Open / Licensed Data

| Source | Data offered | Access method | Cost/auth | License/ToS risk | Verdict |
|---|---|---|---|---|---|
| **Wikivoyage** ★ | Per-city travel guides: See/Do/Eat/Sleep listings with names, addresses, coordinates, descriptions; "Understand" sections = what each city is known for | MediaWiki API (`https://en.wikivoyage.org/w/api.php`), full XML dumps, and the **wikivoyage-listings extractor** (<https://github.com/baturin/wikivoyage-listings>) which outputs listings as CSV/SQL/XML/GPX | Free, no key | **CC BY-SA 4.0** — must attribute and share derivative *text* alike. Facts (names/coords) are fine; verbatim descriptions trigger share-alike | **Tier 1 backbone.** Reuse guide: <https://en.wikivoyage.org/wiki/Wikivoyage:How_to_re-use_Wikivoyage_guides> |
| **Wikipedia** | City overviews, "known for" facts, attraction articles, images (Commons) | REST/Action API, dumps | Free | CC BY-SA 4.0 (same caveats); facts uncopyrightable | **Tier 1** for city blurbs (rewrite, don't copy) |
| **Wikidata** ★ | Structured entities: tourist attractions, coordinates, admin hierarchy, images, official websites, UNESCO status | SPARQL endpoint <https://query.wikidata.org/>, Linked Data API, dumps | Free | **CC0 — zero risk, no attribution required** | **Tier 1.** Ideal for the attraction entity backbone + linking Wikipedia/Wikivoyage/OSM IDs |
| **OpenStreetMap + Overpass API** | POIs (`tourism=*`, `amenity=*`, `leisure=*`), geometry, WGS-84 coords | Overpass API (<https://overpass-api.de/>), Geofabrik China extract, planet dumps | Free (fair-use on public instances) | **ODbL** — attribution + share-alike on derivative *databases* | **Tier 1 supplement.** China coverage decent in tier-1/2 cities, patchy elsewhere. Data is WGS-84 (no offset), but **never mix with GCJ-02 coords from AMap without conversion**. Wiki: <https://wiki.openstreetmap.org/wiki/China> |
| **Open-Meteo** ★ | Historical Weather API (ERA5, 1940–present) → compute monthly climate normals per city; forecast API; dedicated Climate API | REST, no API key | Free for non-commercial, 10,000 calls/day; paid plans for commercial | Data **CC BY 4.0** (attribute); server code AGPL (irrelevant for API calls) | **Tier 1 for seasonal guidance.** Precompute per-city monthly normals once, store statically. <https://open-meteo.com/en/docs/historical-weather-api> |
| **OpenWeatherMap** | Current/forecast free; **Statistical Weather Data API (climate aggregates) is paid-only** | REST, API key | Free tier 1k calls/day (no climate stats) | Standard commercial ToS | **Skip — Open-Meteo does the climate-normals job free** |

## Category 3: Scraping Candidates (feasibility & legality)

| Source | Data offered | robots.txt stance (fetched 2026-08-10) | Anti-bot reputation | Legal/ToS risk | Verdict |
|---|---|---|---|---|---|
| **Mafengwo (马蜂窝)** | Chinese UGC travel notes, POI rankings, itineraries | `User-agent: * → Disallow: /` — all non-search-engine crawlers fully blocked | Heavy (login walls, fingerprinting) | **High.** China's Anti-Unfair Competition Law has been enforced against review scraping (Hantao/Dianping v. Baidu, ~¥3M, Shanghai Pudong court 2016). Mafengwo itself had a 2018 scraped-review scandal — the data is partly tainted anyway | **Avoid** |
| **Dianping (大众点评)** | Restaurant/POI reviews, ratings — best food data in China | Blocks GPTBot, Bytespider, amap.com etc. outright | **Very hostile**: custom-font glyph obfuscation, device fingerprinting, login walls; owner Meituan litigates | **Highest.** Dianping's owner is the winning plaintiff in the landmark anti-scraping case above | **Avoid — the single most legally dangerous target on this list** |
| **Xiaohongshu (小红书/RedNote)** | Trend/UGC content, "what's hot" per city | `User-agent: * → Disallow: /` (tiny carve-outs for named engines) | Aggressive: signed requests (x-s "Shield" signature), account + device binding | High — AUCL + PIPL (personal data in UGC) | **Avoid** |
| **Qunar** | Flights/trains/hotels prices | Surprisingly permissive except booking/user paths | Fare endpoints protected | Medium; owned by Trip.com Group anyway | **Unnecessary** — Trip.com channels supersede it |
| **TravelChinaGuide** | English editorial city guides, train info, weather-by-month pages | Permissive (only admin/cgi paths blocked) | Low | Content is **copyrighted commercial editorial** — republishing text is infringement even if crawling is tolerated | **Reference for manual curation only; never republish text** |
| **ChinaHighlights** | English editorial guides, "best time to visit" | Permissive for general agents, but explicitly blocks site-copier tools | Low-medium | Same — copyrighted editorial | **Reference only** |

## Category 4: Trains / Transport

| Source | Data offered | Access method | Cost/auth | Risk | Verdict |
|---|---|---|---|---|---|
| **12306 (China Railway)** | Timetables, seat availability, tickets | **Confirmed: no official public API.** Undocumented JSON endpoints exist (power some open-source projects) but are unofficial, unstable, geo-fenced | n/a | Unauthorized; endpoints break without notice | **Don't build production features on it** |
| **Juhe 聚合数据 (juhe.cn)** | Train timetable + real-time seat availability APIs | REST, API key | Freemium, but **requires Chinese account + real-name verification** | Medium | **Only viable with a Chinese entity — park it** |
| **Trip.com Trains** | Full China rail search + booking in English, intl. cards, no Chinese ID needed | Affiliate deep links now; partner API later | Free affiliate | Low | **Recommended booking handoff for users** |
| **Static curated route matrix** | Planning-grade durations/frequencies for top ~50 city pairs | Hand-curated JSON (HSR covers 96% of cities >500k pop.) | Free | None (facts) | **Tier 1** — a planner needs "is it 2h or 8h between cities," not live seat inventory |

## Recommended Data Strategy

### Tier 1 — Safe, use now (what this app ships with)
1. **Curated core dataset (own JSON/TS)** for the cities travellers actually visit: city summary, "known for" tags, activity categories, best seasons. A hand-curated file beats every API for quality-per-effort at this scale. *(Implemented in `lib/data/`.)*
2. **Wikidata (CC0)** as the attraction entity backbone via SPARQL — names (zh + en), coordinates, images. Zero license burden.
3. **Wikivoyage listings** via dump extraction for See/Do/Eat POIs (attribute; rewrite descriptions to escape share-alike on text).
4. **OSM/Overpass** to backfill POI coordinates/categories (ODbL attribution; keep WGS-84; convert any GCJ-02 input with `eviltransform`).
5. **Open-Meteo Historical API** → precompute per-city monthly climate normals once; store statically; attribute CC BY 4.0.
6. **Static HSR route matrix** for transport planning.

### Tier 2 — Official APIs worth signing up for
1. **Klook affiliate** — activities/tickets monetisation + deep links; upgrade to Partner API with volume.
2. **Trip.com affiliate** — hotels + trains booking handoff; apply to partner API later.
3. **AMap via Alibaba Cloud Marketplace** — 10k free calls/mo; the authoritative China POI source when curated data isn't enough. Budget the GCJ-02→WGS-84 conversion from day one.

### Tier 3 — Avoid / high risk
- **Scraping Dianping, Mafengwo, Xiaohongshu**: robots.txt-blocked, technically hostile (font obfuscation, signed requests), and legally dangerous under China's Anti-Unfair Competition Law — Dianping's owner already won ~¥3M against Baidu for exactly this.
- **Amadeus self-service**: decommissioned 2026-07-17; keys dead.
- **Baidu Maps direct / AMap direct / Juhe**: all require Chinese ID or business license.
- **Unofficial 12306 endpoints in production**: unauthorized and unstable.
- **Google Places for China POI**: sparse/stale — fallback only.
