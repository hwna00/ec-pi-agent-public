import { statSync } from "node:fs";
import { join, relative, resolve, sep, isAbsolute } from "node:path";
import { contextDirectory, contextSelection, readJSON } from "./session.ts";
import { piRoot } from "../browser/transport.ts";

// Resolve saved selections through the catalog so resumed sessions and moved
// documents use the current location without rewriting session metadata.
export function createContextPathReader(ctx): () => string | undefined {
  let root: string;
  try {
    const config = readJSON(
      process.env.ECOUNT_CONTEXT_CONFIG || join(piRoot, "ec-context.json"),
      {},
    );
    root = contextDirectory(ctx, config);
  } catch {
    return () => undefined;
  }
  const catalogPath = join(root, ".context", "catalog.json");
  let revision: string | undefined;
  let catalog: any;
  return () => {
    try {
      const entry = contextSelection(ctx.sessionManager);
      if (!entry) return;
      const stat = statSync(catalogPath);
      const nextRevision = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      if (revision !== nextRevision) {
        catalog = readJSON(catalogPath);
        revision = nextRevision;
      }
      const path = catalog?.version === 1 ? catalog.posts?.[entry]?.path : undefined;
      if (typeof path !== "string" || !path.trim()) return;
      const absolute = resolve(root, path);
      const local = relative(root, absolute);
      if (local === ".." || local.startsWith(".." + sep) || isAbsolute(local)) return;
      return absolute;
    } catch {
      // A missing or damaged catalog must not break the terminal footer.
      catalog = undefined;
      revision = undefined;
      return;
    }
  };
}
