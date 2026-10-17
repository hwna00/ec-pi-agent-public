import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Connection {
  url: string;
  token: string;
}

export function findConnectionFile(workspacePath: string): string | undefined {
  let directory = resolve(workspacePath);
  for (;;) {
    const file = join(directory, ".pi", ".local", "pi-vscode.json");
    if (existsSync(file)) return file;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function readConnection(workspacePath = process.cwd()): Connection {
  const file = findConnectionFile(workspacePath);
  if (!file) throw new Error("프로젝트의 .pi/.local/pi-vscode.json 연결 설정이 없습니다.");
  const connection = JSON.parse(readFileSync(file, "utf8"));
  connectionUrl(connection);
  return { url: connection.url, token: connection.token };
}

export function connectionUrl(connection: Connection): URL {
  if (typeof connection?.url !== "string" || typeof connection.token !== "string" || !connection.token) {
    throw new Error(".pi/.local/pi-vscode.json에 url과 token을 설정하세요.");
  }
  const url = new URL(connection.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || Number(url.port) < 1) {
    throw new Error("연결 url은 http://127.0.0.1:<고정 포트> 형식이어야 합니다.");
  }
  return url;
}
