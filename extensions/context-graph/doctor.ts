import { BrowserPool } from "./browser.ts";
import { serverSpec, piRoot } from "./mcp.ts";
import { readJSON } from "./session.ts";
import { join } from "node:path";
const config = readJSON(
  process.env.ECOUNT_CONTEXT_CONFIG || join(piRoot, "ec-context.json"),
  {},
);
const pool = new BrowserPool(
  (config.browsers || [{ provider: "chrome" }]).map((s) =>
    serverSpec(s.provider, { ...s, sessionId: "doctor" }),
  ),
);
try {
  const candidates = await pool.discover();
  console.log(
    JSON.stringify(
      {
        connectedBrowsers: pool.browsers.map((b) => b.id),
        failedBrowsers: pool.failures,
        erpTabs: candidates.map((c) => ({
          browser: c.browser.id,
          tab: c.page.id,
          host: new URL(c.page.url).hostname,
        })),
        ready: candidates.length > 0,
      },
      null,
      2,
    ),
  );
  if (!candidates.length) process.exitCode = 2;
} finally {
  await pool.close();
}
