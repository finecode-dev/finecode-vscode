# FineCode for VS Code

FineCode for VS Code connects VS Code to your FineCode workspace so diagnostics, code actions, and action execution come from the same FineCode configuration you use in CLI/CI.

## What This Extension Provides

- Diagnostics from FineCode LSP
- Code formatting
- Code actions / quick fixes from FineCode handlers
- FineCode action explorer in the Activity Bar

## Requirements

- VS Code `1.105+`
- A workspace with FineCode already set up

For FineCode installation, presets, and environment preparation, use the official docs:

- <https://finecode-dev.github.io/getting-started/>
- <https://finecode-dev.github.io/configuration/>

The extension expects FineCode in:

- `.venvs/dev_workspace/bin/python` (Linux/macOS)

## Quick Start

1. Set up FineCode in your project using:
   - <https://finecode-dev.github.io/getting-started/>
2. Ensure `.venvs/dev_workspace` exists and `prepare-envs` has been run.
3. Open the project folder in VS Code.
4. The extension starts FineCode LSP automatically.

## How It Works

On activation, the extension locates `.venvs/dev_workspace/bin/python` in the workspace and starts:

```bash
<workspace>/.venvs/dev_workspace/bin/python -m finecode.cli start-lsp --trace
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

## Troubleshooting

### No `dev_workspace` found

If you see logs about missing `dev_workspace`, verify:

```bash
ls .venvs/dev_workspace/bin/python
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
