# FineCode for VS Code

FineCode for VS Code connects VS Code to your FineCode workspace so diagnostics, code actions, and action execution come from the same FineCode configuration you use in CLI/CI.

Install from the Visual Studio Marketplace:

- <https://marketplace.visualstudio.com/items?itemName=VladyslavHnatiuk.finecode-vscode>

## What This Extension Provides

- Diagnostics from FineCode LSP
- Code formatting
- Code actions / quick fixes from FineCode handlers
- FineCode action explorer in the Activity Bar
- Native VS Code Test Explorer integration (discover and run tests via the Testing panel)

## Requirements

- VS Code `1.109+`
- A workspace with FineCode already set up

For FineCode installation, presets, and environment preparation, use the official docs:

- <https://finecode-dev.github.io/getting-started/>
- <https://finecode-dev.github.io/configuration/>

The extension expects FineCode in:

- `.venvs/dev_workspace/bin/python` (Linux/macOS)
- `.venvs\dev_workspace\Scripts\python.exe` (Windows)

## Quick Start

1. Set up FineCode in your project using:
   - <https://finecode-dev.github.io/getting-started/>
2. Ensure `.venvs/dev_workspace` exists and `prepare-envs` has been run.
3. Open the project folder in VS Code.
4. The extension starts FineCode LSP automatically.

## How It Works

On activation, the extension locates the `dev_workspace` Python in the workspace and starts FineCode LSP:

```bash
<workspace>/.venvs/dev_workspace/bin/python -m finecode.cli start-lsp --trace
```

On Windows, the equivalent path is:

```powershell
<workspace>\.venvs\dev_workspace\Scripts\python.exe -m finecode.cli start-lsp --trace
```

FineCode behavior is controlled by your FineCode config (`pyproject.toml`, presets, env vars, CLI overrides), not by per-project VS Code extension config.

## Commands

- `FineCode: Reload` (`finecode.refreshActions`)
- `FineCode: Restart Workspace Manager` (`finecode.restartWorkspaceManager`)
- `FineCode Actions` (`finecode.showEditorActions`)

## Settings

### `finecode.showNotifications`

Controls when extension notifications are shown:

- `off` (default)
- `onError`
- `onWarning`
- `always`

### `finecode.logLevel`

Log level for the FineCode LSP server and Workspace Manager server:

- `TRACE`
- `DEBUG`
- `INFO` (default)
- `WARNING`
- `ERROR`

## Testing

The extension integrates with VS Code's native Testing panel (the beaker icon in the Activity Bar).

### Setup

See the FineCode docs for the current testing integration setup steps:

- <https://finecode-dev.github.io/getting-started-ide-mcp/#testing-integration>

### Usage

- Open the **Testing** panel — tests are discovered automatically when the workspace loads.
- Click **Run** next to any test, class, or file to run that scope.
- Failed tests show inline error messages with file and line location.
- The test tree mirrors your project structure: file → class → function.

## Troubleshooting

### No `dev_workspace` found

If you see logs about missing `dev_workspace`, verify:

```bash
ls .venvs/dev_workspace/bin/python
```

```powershell
dir .venvs\dev_workspace\Scripts\python.exe
```

If missing, complete FineCode setup from:

- <https://finecode-dev.github.io/getting-started/>

### No diagnostics or actions

- Confirm FineCode actions are configured in your workspace
- Confirm file language is Python
- Open output channel **Finecode LSP Server** and check startup/runtime logs

## Documentation

- Docs home: <https://finecode-dev.github.io/>
- IDE integration: <https://finecode-dev.github.io/ide-integration/>
- CLI reference: <https://finecode-dev.github.io/cli/>
- Configuration: <https://finecode-dev.github.io/configuration/>
