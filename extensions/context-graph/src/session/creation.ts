import { resolve } from "node:path";

type PendingCreation = { cwd: string; sourceId: string };
const key = Symbol.for("ec-context.pending-session-creation");
// Pi reloads extension modules on replacement. Share only this short-lived
// coordination state across the outgoing command and incoming startup hook.
const state = globalThis as typeof globalThis & {
  [key]?: Set<PendingCreation>;
};
const pending = () => (state[key] ??= new Set<PendingCreation>());
const directory = (ctx) => {
  const cwd = resolve(ctx.cwd);
  return process.platform === "win32" ? cwd.toLowerCase() : cwd;
};

export async function withContextSessionCreation<T>(
  ctx,
  create: () => Promise<T>,
): Promise<T> {
  const creation = {
    cwd: directory(ctx),
    sourceId: ctx.sessionManager.getSessionId(),
  };
  pending().add(creation);
  try {
    return await create();
  } finally {
    pending().delete(creation);
  }
}

export function isContextSessionCreation(ctx): boolean {
  return [...pending()].some(
    (creation) =>
      creation.cwd === directory(ctx) &&
      creation.sourceId !== ctx.sessionManager.getSessionId(),
  );
}
