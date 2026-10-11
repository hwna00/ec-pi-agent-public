import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createVSIX } from "@vscode/vsce";
import "./build.mjs";

// 먼저 빌드한 뒤, 설치 도구의 기본 기능으로 VSIX를 만든다.
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("vscode/package.json", root), "utf8"));
const output = fileURLToPath(new URL(`../pi-vscode-debug-${version}.vsix`, root));

await createVSIX({
  cwd: fileURLToPath(new URL("vscode/", root)),
  packagePath: output,
  dependencies: false,
  allowMissingRepository: true,
  skipLicense: true,
});
console.log(`Packaged: ${output}`);
