import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Installed as <project>/.pi/extensions/time-log.
export const piRoot = fileURLToPath(new URL("../../", import.meta.url));

export function readJSON(path: string, fallback: any = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function privateJSON(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
