import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Config = { mcpServers: Record<string, { args: string[] }> };

export default function switchPgConnection(pi: ExtensionAPI) {
  pi.registerCommand("switch-pg-connection", {
    description: "PG MCP의 연결 주소를 서버 번호에 맞춰 변경",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!/^\d{1,2}$/.test(input)) {
        ctx.ui.notify("사용법: /switch-pg-connection <0~99 서버 번호>", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("현재 작업이 끝난 뒤 /switch-pg-connection을 실행하세요.", "warning");
        return;
      }

      try {
        const path = join(ctx.cwd, ".pi", "mcp.json");
        const config = JSON.parse(await readFile(path, "utf8")) as Config;
        const server = config.mcpServers.pg_zeus;
        if (!server) throw new Error();
        const connections = server.args?.filter(arg => typeof arg === "string" && /^postgres(?:ql)?:\/\//.test(arg));
        if (connections?.length !== 1) throw new Error();

        const connection = new URL(connections[0]);
        const host = connection.hostname.split(".");
        if (host.length !== 4 || host[2].length !== 3 ||
            host.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) throw new Error();
        host[2] = host[2][0] + input.padStart(2, "0");
        if (Number(host[2]) > 255) throw new Error();
        connection.hostname = host.join(".");
        server.args = server.args.map(arg => arg === connections[0] ? connection.href : arg);

        const temporary = `${path}.${process.pid}.tmp`;
        try {
          const mode = (await stat(path)).mode & 0o777;
          await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode });
          await chmod(temporary, mode);
          await rename(temporary, path);
        } finally {
          await unlink(temporary).catch(() => {});
        }
        ctx.ui.notify(`PG 서버 ${Number(input)} 설정 저장. 다시 불러옵니다.`, "info");
      } catch {
        ctx.ui.notify("PG 설정 변경 실패: .pi/mcp.json의 PG 서버와 연결 정보를 확인하세요.", "error");
        return;
      }

      try {
        await ctx.reload();
      } catch {
        ctx.ui.notify("PG 설정은 저장됐습니다. /reload를 실행하세요.", "error");
      }
    },
  });
}
