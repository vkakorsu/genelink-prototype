import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The set of server-action identifiers this build emitted. Next writes one
 * server-reference-manifest.json per route under .next/server/app (and under
 * .next/dev/server/app in development); the "node" map's keys are the action ids
 * the runtime can actually resolve. The proxy reads them once so that a well-formed
 * but unknown action id can be refused with a 400 instead of reaching the action
 * runtime and surfacing as a 500.
 *
 * If the manifests cannot be read (unusual layout, first boot before a build) the
 * set is empty and callers must degrade to shape-only checks rather than refuse.
 */
let cached: Set<string> | null = null;

export function knownActionIds(): Set<string> {
  if (cached) return cached;
  const ids = new Set<string>();
  for (const root of [join(process.cwd(), ".next", "server", "app"), join(process.cwd(), ".next", "dev", "server", "app")]) {
    // turbopackIgnore: the manifests are runtime artifacts, read where the server runs, not bundle content
    if (!existsSync(/* turbopackIgnore: true */ root)) continue;
    walk(root, ids);
  }
  cached = ids;
  return ids;
}

function walk(dir: string, ids: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true /* turbopackIgnore: true */ })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p, ids);
    } else if (entry.name === "server-reference-manifest.json") {
      try {
        const manifest = JSON.parse(readFileSync(/* turbopackIgnore: true */ p, "utf8")) as { node?: Record<string, unknown> };
        for (const id of Object.keys(manifest.node ?? {})) ids.add(id);
      } catch {
        // An unreadable manifest contributes nothing; other routes still enumerate.
      }
    }
  }
}
