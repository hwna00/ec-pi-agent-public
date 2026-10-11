/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";
import { z as zod } from "zod";
const identifier = zod.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const binding = zod.object({
  browserId: identifier,
  targetId: zod.string().optional(),
});
const sessionSchema = zod.object({
  version: zod.literal(1),
  active: identifier.optional(),
  browsers: zod.array(binding),
});
const recordSchema = zod.object({
  version: zod.literal(1),
  browserId: identifier,
  endpoint: zod.string().url(),
  managed: zod.boolean(),
});

export async function defaultChromeExecutable() {
  const candidates = process.platform === "win32"
    ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
        .filter(Boolean).map(root => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  throw new Error("Chrome executable not found. Set executablePath for managed Chrome.");
}
/** One private file per browser/session; URLs, cookies and request bodies are not stored. */
export class BrowserRegistry {
  root;
  connectOptions;
  constructor(
    root = path.join(os.homedir(), ".cache", "chrome-devtools-mcp", "registry"),
    connectOptions = {},
  ) {
    this.root = root;
    this.connectOptions = connectOptions;
  }
  file(kind, id) {
    return path.join(this.root, kind, `${identifier.parse(id)}.json`);
  }
  async read(file) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }
  async write(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporary, file);
  }
  async session(id) {
    return sessionSchema.parse(
      (await this.read(this.file("sessions", id))) ?? {
        version: 1,
        browsers: [],
      },
    );
  }
  async bind(sessionId, browserId, targetId) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = path.join(
      this.root,
      `session-${identifier.parse(sessionId)}.lock`,
    );
    await this.lock(lock);
    try {
      const state = await this.session(sessionId);
      const previous = state.browsers.find(
        (item) => item.browserId === browserId,
      );
      state.browsers = state.browsers.filter(
        (item) => item.browserId !== browserId,
      );
      state.browsers.push(
        binding.parse({ browserId, targetId: targetId ?? previous?.targetId }),
      );
      state.active = browserId;
      await this.write(this.file("sessions", sessionId), state);
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  }
  async lock(file) {
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        await fs.mkdir(file);
        return;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`Registry is busy or has a stale lock: ${file}`);
  }
  async list() {
    let files;
    try {
      files = await fs.readdir(path.join(this.root, "browsers"));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
    const records = [];
    for (const name of files.filter((name) => name.endsWith(".json"))) {
      const record = recordSchema.parse(
        await this.read(path.join(this.root, "browsers", name)),
      );
      records.push({ browserId: record.browserId, managed: record.managed });
    }
    return records;
  }
  async connect(endpoint) {
    const parsed = new URL(endpoint);
    if (
      parsed.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    ) {
      throw new Error("Only local browser WebSocket endpoints are accepted.");
    }
    return await puppeteer.connect({
      ...this.connectOptions,
      browserWSEndpoint: endpoint,
      defaultViewport: null,
    });
  }
  async acquire(browserId, options = {}) {
    identifier.parse(browserId);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = path.join(this.root, `browser-${browserId}.lock`);
    // Serialize creation across MCP processes. A crashed owner leaves an explicit,
    // inspectable lock rather than risking duplicate launches.
    await this.lock(lock);
    try {
      const file = this.file("browsers", browserId);
      if (options.endpoint) {
        const endpoint = new URL(options.endpoint);
        if (
          !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
          !["ws:", "http:", "https:"].includes(endpoint.protocol)
        ) {
          throw new Error("Only local browser endpoints are accepted.");
        }
        const browser =
          endpoint.protocol === "ws:"
            ? await this.connect(options.endpoint)
            : await puppeteer.connect({
                ...this.connectOptions,
                browserURL: options.endpoint,
                defaultViewport: null,
              });
        try {
          await this.write(file, {
            version: 1,
            browserId,
            endpoint: browser.wsEndpoint(),
            managed: false,
          });
          return browser;
        } catch (error) {
          await browser.disconnect();
          throw error;
        }
      }
      const raw = await this.read(file);
      if (raw) {
        const record = recordSchema.parse(raw);
        try {
          return await this.connect(record.endpoint);
        } catch (error) {
          if (!options.create) {
            throw new Error(
              `Saved browser ${browserId} is unavailable. Explicitly create it again or choose another browser.`,
              { cause: error },
            );
          }
        }
      }
      if (!options.create) {
        try {
          const browser = await puppeteer.connect({
            ...this.connectOptions,
            channel: "chrome",
            defaultViewport: null,
          });
          await this.write(file, {
            version: 1,
            browserId,
            endpoint: browser.wsEndpoint(),
            managed: false,
          });
          return browser;
        } catch (error) {
          if (process.platform !== "darwin") {
            throw new Error(
              "Cannot attach to Chrome. Enable remote debugging or explicitly create a managed browser.",
              { cause: error },
            );
          }
          let running = true;
          try {
            await promisify(execFile)("pgrep", ["-x", "Google Chrome"]);
          } catch (probeError) {
            if (
              probeError instanceof Error &&
              "code" in probeError &&
              probeError.code === 1
            ) {
              running = false;
            } else {
              throw probeError;
            }
          }
          if (running) {
            throw new Error(
              "Chrome is already open. Enable chrome://inspect/#remote-debugging and allow the connection. No new window was opened.",
              { cause: error },
            );
          }
        }
      }
      const profile = path.join(this.root, "profiles", browserId);
      await fs.mkdir(profile, { recursive: true, mode: 0o700 });
      const portFile = path.join(profile, "DevToolsActivePort");
      // A profile may still be running after another client exited.
      try {
        const [port, target] = (await fs.readFile(portFile, "utf8"))
          .trim()
          .split("\n");
        const browser = await this.connect(`ws://127.0.0.1:${port}${target}`);
        await this.write(file, {
          version: 1,
          browserId,
          endpoint: browser.wsEndpoint(),
          managed: true,
        });
        return browser;
      } catch {
        /* Closed browser; launch under the per-browser lock. */
      }
      await fs.rm(portFile, { force: true });
      const executable =
        options.executablePath ??
        await defaultChromeExecutable();
      const child = spawn(
        executable,
        [
          `--user-data-dir=${profile}`,
          "--remote-debugging-port=0",
          "--remote-debugging-address=127.0.0.1",
          "--no-first-run",
          "--no-default-browser-check",
          ...(options.headless ? ["--headless=new"] : []),
          "about:blank",
        ],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      let launchError;
      child.on("error", (error) => {
        launchError = error;
      });
      child.unref();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (launchError) {
          throw launchError;
        }
        if (child.exitCode !== null) {
          throw new Error(
            "Managed Chrome exited before opening its debugging endpoint.",
          );
        }
        try {
          const [port, target] = (await fs.readFile(portFile, "utf8"))
            .trim()
            .split("\n");
          const browser = await this.connect(`ws://127.0.0.1:${port}${target}`);
          await this.write(file, {
            version: 1,
            browserId,
            endpoint: browser.wsEndpoint(),
            managed: true,
          });
          return browser;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      child.kill("SIGTERM");
      throw new Error(
        "Managed Chrome did not expose its debugging endpoint within 10 seconds.",
      );
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  }
}
