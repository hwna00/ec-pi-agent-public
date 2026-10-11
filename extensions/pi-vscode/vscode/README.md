# Pi VS Code Debug Console

Version: 0.1.6.

This companion connects desktop VS Code to the Pi `pi-vscode` extension.
It captures debug console output and controls compound debug sessions.
It accepts authenticated HTTP requests from `127.0.0.1`.

## Install and connect

1. Install `pi-vscode-debug-0.1.6.vsix`.
2. Open the project folder in VS Code.
3. Create `<project>/.pi/.local/pi-vscode.json`.
4. Set its `url` to `http://127.0.0.1:32124`.
5. Set its `token` to a fixed local token.
6. Run **Developer: Reload Window**.
7. Start Pi from the same project.

Both extensions read the same file.
The URL and token remain the same after a reload.
You do not need environment variables or connection information from the clipboard.
Keep the connection file outside Git history.

Use one VS Code window for this project.
A second window for the same project cannot use the same port.
Other project windows do not start a bridge unless they contain a connection file.

## Use Pi commands

Run `/run-and-debug` to start `Run & Debug [ERP]`.
The target project is `D:/ecxsolution/ecount.nextv56/ecount.solution`.
This command uses a fixed target and does not show a selection dialog.

Run `/stop-debug` to select a run for termination.
Run `/stop-debug <runId>` to stop a specific run.
The bridge only stops sessions that it recorded for that run.
The debug adapter controls termination of the associated processes.

## Read console output

Ask the Pi model to use `vscode_debug_console`.
The default read returns the latest ten entries.
The bridge stores up to 1,000 entries and 16 KiB per entry.
An entry is one debugger output event or one console evaluation result.

Start debug sessions after the companion activates.
The companion does not capture earlier output, Watch results, Hover results, or expanded object values.
It also does not capture output that appears only in the integrated terminal.

Debug termination keeps captured entries.
VS Code reload clears console entries and tracked runs.
Reload does not change the connection file.

**Pi VS Code: Copy Connection Info** remains available for manual checks.
The old `pi-vscode.port` setting does not control the bridge.
Read the Pi package README for tool parameters, development commands, and test results.
