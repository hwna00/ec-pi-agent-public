import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { BridgeError } from "../../shared/store.ts";
import type { DebugConsolePage } from "../../shared/types.ts";
import type { DebugRequest, DebugControlResult } from "../../shared/debug.ts";

export type ReadQuery = {
  limit?: number;
  before?: string;
  sessionId?: string;
};

function reply(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function parseQuery(url: URL): ReadQuery {
  // 조회 조건만 읽는다. 값이 올바른지는 저장소가 확인한다.
  const limit = url.searchParams.get("limit");

  return {
    limit: limit === null ? undefined : Number(limit),
    before: url.searchParams.get("before") ?? undefined,
    sessionId: url.searchParams.get("sessionId") ?? undefined,
  };
}

export async function startServer(
  port: number,
  token: string,
  read: (query: ReadQuery) => DebugConsolePage,
  control?: (request: DebugRequest) => Promise<DebugControlResult>,
) {
  const expectedToken = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (request, response) => {
    try {
      // 이 컴퓨터의 정확한 주소로 보낸 요청만 받는다. 웹 페이지의 요청은 거절한다.
      const boundPort = (server.address() as AddressInfo).port;
      if (request.headers.host !== `127.0.0.1:${boundPort}` || request.headers.origin !== undefined) {
        throw new BridgeError(403, "Only direct loopback clients are accepted");
      }

      // 길이를 먼저 확인한 뒤 비밀 토큰을 비교한다.
      const suppliedToken = Buffer.from(request.headers.authorization ?? "");
      if (suppliedToken.length !== expectedToken.length || !timingSafeEqual(suppliedToken, expectedToken)) {
        throw new BridgeError(401, "Invalid bearer token");
      }

      const url = new URL(request.url ?? "/", `http://127.0.0.1:${boundPort}`);
      if (url.pathname === "/debug" && control) {
        if (request.method !== "POST") throw new BridgeError(405, "Use POST");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 8192) throw new BridgeError(413, "Request body too large");
          chunks.push(chunk);
        }
        let params: DebugRequest;
        try { params = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new BridgeError(400, "Expected JSON object"); }
        if (!params || typeof params !== "object" || Array.isArray(params)) throw new BridgeError(400, "Expected JSON object");
        reply(response, 200, await control(params));
        return;
      }
      // 기존 콘솔 조회는 GET으로 유지한다.
      if (request.method !== "GET") {
        throw new BridgeError(405, "Use GET");
      }

      if (url.pathname !== "/debug-console") {
        throw new BridgeError(404, "Unknown route");
      }

      reply(response, 200, read(parseQuery(url)));
    } catch (error) {
      const knownError = error instanceof BridgeError;
      reply(response, knownError ? error.status : 500, {
        error: knownError ? error.message : "Internal error",
      });
    }
  });

  // 같은 컴퓨터에서만 접속할 수 있도록 127.0.0.1에 서버를 연다.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return {
    port: (server.address() as AddressInfo).port,
    server,
    close: () => {
      // 확장이 종료되면 서버와 남아 있는 연결도 함께 닫는다.
      server.close();
      server.closeAllConnections();
    },
  };
}
