import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  /**
   * Scope: this block describes the FIRST rule below only — the committed
   * topology assets. Every rule after it carries its own docblock and its own
   * window; this note deliberately does not enumerate them, because a list
   * maintained by hand here is wrong the moment a rule is added below.
   *
   * The committed topology assets, which Next otherwise serves with
   * `Cache-Control: public, max-age=0` — it cannot know that a given file under
   * `public/` is safe to cache. These are: each changes only when its build
   * script is deliberately re-run and the result committed, and the globe asset
   * is fetched on every picker open.
   *
   * A day, then a week of stale-while-revalidate, so a rebuild reaches users
   * within a day without any picker open paying for a revalidation.
   *
   * BEFORE ANY SCHEMA-BREAKING REBUILD OF THESE ASSETS, ship a cache bust first
   * — a hashed filename or a query string. These URLs carry no content hash, so
   * a client can hold yesterday's bytes for up to a day while newly deployed code
   * ships instantly and expects the new shape. A pure data refresh is fine: the
   * parsers throw loudly rather than degrade. A shape change is not, and the
   * picker's own "Try again" would re-request the same cached copy.
   *
   * Note the wall interacts with this: `proxy.ts` puts everything under `public/`
   * behind the login redirect, and that redirect is `no-store` precisely so a
   * signed-out request cannot park a day-long cached bounce in front of the asset.
   */
  async headers() {
    return [
      {
        source: "/:asset(world-countries\\.json|world-globe\\.json|china-provinces\\.json)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        /**
         * The 246 city shards, their index and their enrichment files.
         *
         * A separate rule because the one above matches a SINGLE path segment
         * with an inline regex — `/cities/PE.json` has two, so it would fall
         * through to Next's `public, max-age=0` for public/ files and a country
         * switch would refetch 22 KB every time. `:path+` matches the whole
         * subtree, which is right: everything under /cities/ is the same kind
         * of generated artifact with the same lifecycle.
         *
         * `:path+` (one-or-more) rather than `:path*` (zero-or-more): the
         * star form also matches the bare `/cities` and `/cities/`, which are
         * not files — a 404 served under those URLs would carry a six-hour
         * `public` cache. The plus form is strictly tighter and loses nothing;
         * `lib/cacheHeaders.test.ts` pins both directions.
         *
         * A shorter window than the topology assets deliberately. These change
         * whenever the daily workflow finds movement upstream, where a topology
         * changes only when someone re-runs a build script by hand. Six hours
         * plus a day of stale-while-revalidate means a refresh reaches a
         * returning user the same day without any picker open paying for a
         * revalidation.
         *
         * BEFORE ANY SCHEMA-BREAKING REBUILD OF THESE FILES, ship a cache bust
         * first — a hashed filename or a query string. These URLs carry no
         * content hash, so a client can hold this morning's bytes while newly
         * deployed code expects a new shape. A pure data refresh is fine:
         * `parseCityShard` throws loudly rather than degrading. A shape change
         * is not.
         */
        source: "/cities/:path+",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=21600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        /**
         * The 246 province files and their index (spec §4.1).
         *
         * Its own rule for exactly the reason /cities/ needs one: the topology
         * rule above matches a SINGLE path segment, so `/provinces/CA.json`
         * has two and would fall through to Next's `public, max-age=0` for
         * public/ files. The largest file in the artifact is CA, measured at
         * 139,477 B gzipped, and PR4 fetches one of these on every map open.
         *
         * The topology assets' day-long window rather than the cities' six
         * hours, because these have the topology assets' lifecycle: the build
         * is invoked by hand and its output committed, where the city shards
         * are rewritten whenever the daily workflow finds movement upstream.
         *
         * `:path+` (one-or-more) rather than `:path*` (zero-or-more) for the
         * same reason as above: the star form also matches the bare
         * `/provinces` and `/provinces/`, which are not files.
         *
         * BEFORE ANY SCHEMA-BREAKING REBUILD OF THESE FILES, ship a cache bust
         * first — a hashed filename or a query string. These URLs carry no
         * content hash, so a client can hold yesterday's bytes while newly
         * deployed code expects a new shape. A pure data refresh is fine:
         * `parseProvinceTopology` throws loudly rather than degrading.
         */
        source: "/provinces/:path+",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        /**
         * The per-country climate files. public/climate/ does not exist yet —
         * Plan 5 builds it — and the rule lands ahead of it deliberately: a
         * header rule for a path Next serves nothing at is inert, so it costs
         * nothing today, and the alternative is remembering to add it later,
         * after the first uncached fetch has already shipped.
         *
         * Same window and same `:path+` reasoning as the province rule above;
         * these are the same kind of by-hand-rebuilt committed artifact.
         */
        source: "/climate/:path+",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
