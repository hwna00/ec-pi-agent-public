import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { join } from "node:path";
import { readJSON } from "../state.ts";

export interface BrowserSpec {
  id: string;
  sessionId: string;
  registry: string;
  endpoint: string;
  reuseExisting: true;
  managedProfile: false;
  attachOnly: true;
}

/** An operation-local CDP attachment. It never launches Chrome or changes its registry. */
export class BrowserPool {
  private browser?: Browser;
  private specs: BrowserSpec[];
  private connect: typeof puppeteer.connect;
  constructor(
    specs: BrowserSpec[],
    connect = puppeteer.connect.bind(puppeteer),
  ) {
    this.specs = specs;
    this.connect = connect;
  }
  async discover() {
    if (this.specs.length !== 1)
      throw new Error("저장된 Chrome 연결 하나가 필요합니다.");
    const spec = this.specs[0],
      endpoint = new URL(spec.endpoint);
    if (
      endpoint.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
    )
      throw new Error("저장된 로컬 Chrome 주소가 필요합니다.");
    const saved = readJSON(join(spec.registry, "browsers", `${spec.id}.json`));
    if (
      saved?.version !== 1 ||
      saved.browserId !== spec.id ||
      saved.endpoint !== spec.endpoint
    )
      throw new Error(
        "저장된 Chrome 주소가 변경되었습니다. /ec-connect로 다시 연결하세요.",
      );
    this.browser = await this.connect({
      browserWSEndpoint: endpoint.href,
      defaultViewport: null,
    });
    const pages = new Map<number, Page>();
    let selected: Page | undefined;
    const describeCurrent = async () => {
      pages.clear();
      const identities: { pageId: number; targetId: string; url: string }[] =
        [];
      for (const page of await this.browser!.pages()) {
        const session = await page.createCDPSession();
        try {
          const { targetInfo } = await session.send("Target.getTargetInfo");
          const pageId = identities.length + 1;
          pages.set(pageId, page);
          identities.push({
            pageId,
            targetId: targetInfo.targetId,
            url: page.url(),
          });
        } finally {
          await session.detach();
        }
      }
      return { pages: identities };
    };
    const browser = {
      id: spec.id,
      describeCurrent,
      select: async (id: number) => {
        selected = pages.get(id);
        if (!selected) throw new Error("저장된 Chrome 탭이 닫혔습니다.");
      },
      evaluate: async (script: string) => {
        if (!selected) throw new Error("저장된 Chrome 탭을 선택하세요.");
        return selected.evaluate(`(${script})()`);
      },
    };
    return (await describeCurrent()).pages.map((page) => ({
      browser,
      page: { id: page.pageId, url: page.url },
    }));
  }
  async close() {
    await this.browser?.disconnect();
    this.browser = undefined;
  }
}
