import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  /**
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
    ];
  },
};

export default nextConfig;
