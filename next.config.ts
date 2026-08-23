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
