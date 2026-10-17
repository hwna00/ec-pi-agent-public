import { runReader } from "./reader.ts";
import { ContextError } from "./graph.ts";
import { Browser, erpURL } from "./browser.ts";
import { MCP, serverSpec } from "./mcp.ts";
const args = process.argv.slice(2),
  position = args.indexOf("--store-dir");
let browser: Browser | undefined;
try {
  if (position < 0 || !args[position + 1])
    throw new ContextError("--store-dir is required");
  const directory = args.splice(position, 2)[1],
    endpointIndex = args.indexOf("--cdp"),
    endpoint = endpointIndex < 0 ? undefined : args.splice(endpointIndex, 2)[1];
  const offline =
    args.includes("--fixtures") ||
    args.some((x) =>
      [
        "list-contexts",
        "migrate-paths",
        "repair-grouping",
        "apply",
        "describe",
        "test-accounts",
        "save-test-account",
        "load",
        "context",
      ].includes(x),
    );
  if (!offline) {
    browser = new Browser(
      await new MCP(
        serverSpec("chrome", {
          sessionId: "context-cli",
          ...(endpoint ? { endpoint } : {}),
        }),
      ).start(),
    );
    const pages = (await browser.pages()).filter((page) => erpURL(page.url));
    if (pages.length !== 1) throw new ContextError("Expected one ERP tab");
    await browser.connect(pages[0]);
  }
  process.stdout.write(
    (await runReader(directory, args, browser, { workspace: true })) + "\n",
  );
} catch (e) {
  const known = e instanceof ContextError;
  process.stdout.write(
    JSON.stringify({
      error: known ? e.message : e instanceof Error ? e.name : "Error",
      code: known ? e.code : "operation_failed",
      post: known ? e.key : null,
    }) + "\n",
  );
  process.exitCode = 2;
} finally {
  await browser?.close();
}
