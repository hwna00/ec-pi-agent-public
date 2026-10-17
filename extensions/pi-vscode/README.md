# pi-vscode

Version: 0.1.6.

Pi reads the VS Code debug console and controls compound debug sessions.
A compound is a named group of debug configurations in `launch.json`.
The local bridge is an HTTP server in the VS Code companion extension.

## Requirements

- Desktop VS Code 1.95 or later.
- Node.js 22.19 or later.
- Pi 0.87.1 or later. The current tests use Pi 1.0.0.
- Pi and VS Code on the same computer.
- A trusted project folder in the connected VS Code window.

## Install

1. Open the project folder in VS Code.
2. Install `extensions/pi-vscode-debug-0.1.6.vsix` with **Extensions: Install from VSIX**.
3. Create the connection file described below.
4. Run **Developer: Reload Window** in VS Code.
5. Start Pi from the project folder.
6. Run `/reload` if Pi was already running.

The Pi settings must enable `+extensions/pi-vscode/index.ts`.
Add `vscode_debug` to `defaultTools` to give the main agent direct access to that tool.
Slash commands do not need an entry in `defaultTools`.

## Set the connection

Both extensions read `<project>/.pi/.local/pi-vscode.json`.
Pi also searches parent folders when its current folder is inside the project.

```json
{
  "url": "http://127.0.0.1:32124",
  "token": "<fixed-local-token>"
}
```

Generate the token once. Keep the same token in this file.
Run these commands from the project folder in Git Bash:

```bash
mkdir -p .pi/.local
node -e 'const fs=require("node:fs"),crypto=require("node:crypto");fs.writeFileSync(".pi/.local/pi-vscode.json",JSON.stringify({url:"http://127.0.0.1:32124",token:crypto.randomBytes(32).toString("hex")},null,2)+"\n",{flag:"wx"})'
```

The command refuses to replace an existing file.
The `.pi` repository excludes `.local/` through its `/.local/` ignore rule.
Do not commit the connection file.

The URL and token remain the same after a VS Code reload.
Pi reads the file before each request. VS Code reads it when the extension activates.
Reload VS Code after you change the file.

The extensions do not use `PI_VSCODE_URL`, `PI_VSCODE_TOKEN`, or the old `pi-vscode.port` setting.
You do not need to copy connection information.
**Pi VS Code: Copy Connection Info** remains available for manual checks.

Use one VS Code window for this project.
Two windows for the same project cannot use the same port at the same time.
Other project windows do not start a bridge unless they contain a connection file.

## Run and stop ERP debugging

```text
/run-and-debug
/stop-debug
/stop-debug <runId>
```

`/run-and-debug` directly starts `Run & Debug [ERP]` in `D:/ecxsolution/ecount.nextv56/ecount.solution`.
It does not show a selection dialog. Arguments do not change its target.
It does not call a model.

`/stop-debug` shows the bridge's run list. Select the run to stop.
Cancel the dialog to keep the run active.
`/stop-debug <runId>` directly stops that run.

## Use the model tools

`registerCommand` defines the user commands above.
`registerTool` defines operations that a model can call.
Both paths use the same HTTP client and VS Code bridge.

### Control debug sessions

The `vscode_debug` tool accepts these requests:

```json
{"action":"list"}
```

```json
{"action":"start","workspacePath":"D:/ecxsolution/ecount.nextv56/ecount.solution","compound":"Run & Debug [ERP]"}
```

```json
{"action":"stop","runId":"<runId-from-start-or-list>"}
```

`list` returns compound names, project paths, and runs that the bridge tracks.
`start` returns a run ID, session IDs, and a status.
The status is `starting`, `running`, `stopped`, or `failed`.
If startup fails, the result includes the run ID and an error.
Use that run ID to stop sessions that started before the failure.

The bridge reads compounds through the VS Code `launch` configuration API.
It calls `startDebugging(folder, compoundName)` once with the compound name.
It does not manually start each configuration or change `launch.json`.
Specify `workspacePath` if more than one project contains the same compound name.
Windows path comparison ignores letter case and normalizes path separators.

The bridge stops sessions that it recorded for that run, including child sessions.
It waits for termination events before it reports completion.
Use VS Code to stop sessions that you started manually.
VS Code reload clears the bridge's run records.

Control requests wait for up to 120 seconds.
A client timeout or cancellation does not undo a remote start.
Check the run list before you repeat a start request.
Stopping a debug session does not guarantee termination of every process that it created.
The debug adapter controls process termination.
The Application compound uses the active editor's file path.
Open the required source file before you start that compound through the tool.

### Read the debug console

`vscode_debug_console` reads the latest ten entries by default.
One entry is one output event or one console evaluation result.
An entry can contain more than one line.

| Parameter | Function |
|---|---|
| `limit` | Read 1 to 100 entries. |
| `before` | Read an older page with the preceding result's `nextBefore`. |
| `sessionId` | Read one debug session. |

Use `pi --vscode-debug-limit 20` to change the default count.
A request's `limit` overrides the startup option.
The tool returns selected entries from oldest to newest.
It does not remove entries after a read.

The bridge stores the latest 1,000 entries across all sessions.
It stores up to 16 KiB of UTF-8 text per entry.
It marks text that exceeds this size with `truncated: true`.
Reads return complete stored text without another size reduction.
Debug termination keeps the entries. VS Code reload clears them.

Capture starts with debug sessions created after the companion activates.
Capture includes output events and console evaluation results.
Capture excludes telemetry, Watch results, Hover results, and the original evaluation expression.
It also excludes terminal-only output, expanded object values, and tables that the editor shows.
Parent and child sessions share the parent's console record.

The tool returns readable text in `content` and structured data in `details`.
Pi records tool results in normal session history.
Use `--no-session` to prevent file recording.
Conversation compression may remove original output from the model context.

## Develop and check

The Pi SDK, TypeScript, and Node.js types are installed in `.pi`.
The extension keeps only its VS Code build dependencies.
Run these commands in order from the project folder:

```powershell
npm --prefix .\.pi ci
npm --prefix .\.pi\extensions\pi-vscode ci
npm --prefix .\.pi\extensions\pi-vscode test
npm --prefix .\.pi\extensions\pi-vscode run test:vscode
npm --prefix .\.pi\extensions\pi-vscode run package:vscode
```

| Command | Check or output |
|---|---|
| `npm test` | Type checks, build, unit tests, HTTP tests, and the actual Pi loader. |
| `npm run test:vscode` | Actual VS Code, Node debugger, companion, and Pi integration. |
| `npm run package:vscode` | Build the companion and create a VSIX in `.pi/extensions/`. |

The integration test uses a temporary profile and a temporary Node project.
The test removes its temporary profile and project after it finishes.
It keeps one local result file at `.pi/.local/pi-vscode-e2e-result.json`.
It checks compound startup, output capture, targeted stop, and Windows path comparison.
It does not start the ERP or Application Velox configurations.
The test results do not prove Velox child-process termination.

See [VALIDATION.md](VALIDATION.md) for recorded results.
See [Windows path evidence](validation/vscode-path-windows.json) for the current integration results.

| Change | Apply the change |
|---|---|
| Pi commands, tools, or client | Run `/reload` in Pi. |
| VS Code server, capture, or debug control | Build the VSIX. Install it. Reload VS Code. |
| Connection file | Reload VS Code. Pi reads the current file before each request. |

## Source files

| Path | Function |
|---|---|
| `index.ts` | Register tools and the default console count. |
| `src/pi/commands.ts` | Register `/run-and-debug` and `/stop-debug`. |
| `src/pi/client.ts` | Send authenticated HTTP requests. |
| `src/pi/format.ts` | Format console results. |
| `src/shared/connection.ts` | Find and read the connection file. |
| `src/shared/debug.ts` | Define debug requests and results. |
| `src/shared/store.ts` | Store console entries. |
| `src/vscode/extension.ts` | Start the companion. |
| `src/vscode/debug.ts` | Start compounds and track their sessions. |
| `src/vscode/server.ts` | Authenticate and route requests. |
| `src/vscode/tracker.ts` | Capture debugger messages. |
