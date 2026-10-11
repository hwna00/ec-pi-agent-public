import { build } from "esbuild";

// VS Code용 코드와 공통 코드를 실행 파일 하나로 묶는다.
// vscode 모듈은 VS Code가 제공하므로 묶음에서 제외한다.
await build({
  entryPoints: ["vscode/src/extension.ts"],
  outfile: "vscode/dist/extension.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  minify: true,
});

console.log("Built VS Code companion: vscode/dist/extension.cjs");
