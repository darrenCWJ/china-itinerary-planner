/**
 * What Vitest resolves `import "server-only"` to.
 *
 * The real package throws on import anywhere but a React Server Components
 * build — that is its whole job in `next build`, where it turns a client
 * import of lib/server/* into a build error instead of a silent multi-megabyte
 * artifact in the browser bundle. Vitest is not a bundler and imports those
 * modules from node and jsdom tests alike, so here the guard is inert. See
 * vitest.config.mts.
 */
export {};
