# Change Log

All notable changes to the "finecode-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.6.0] - 2026-06-04

### Added

- New `finecode.workspaceMode` setting to control how Workspace Manager instances are started:
  - `per-folder` (default) — one independent WM instance per VS Code workspace folder, started lazily when the first file in that folder is opened. Recommended for git worktrees workflows.
  - `single` — one WM instance shared across all workspace folders.
- MCP server definitions are now provided per workspace folder in `per-folder` mode.

## [0.5.0] - 2026-05-08

### Changed

- Activate extension not only for Python files, but for all languages. FineCode checks by itself whether support of the file language is configured or not (there is no way in VSCode to provide supported languages dynamically)

## [0.4.1] - 2026-04-25

### Added

- Added an extension icon for the VS Code Marketplace and extension UI.

### Changed

- Improved the README with clearer setup and usage guidance.

### Fixed

- Added Windows support for locating FineCode in the workspace `dev_workspace` virtual environment.


## [0.4.0] - 2026-04-24

### Added

- Native VS Code Testing integration for FineCode-managed test discovery and execution.
- A FineCode MCP server definition provider so VS Code can discover and launch the workspace MCP server.
- A `finecode.logLevel` setting to control FineCode LSP and Workspace Manager logging from the extension.
- Expanded README guidance covering setup, commands, settings, testing, and troubleshooting.

### Changed

- Raised the minimum supported VS Code version to `1.109`.
- Switched LSP communication from stdio to TCP when starting FineCode from the extension.

### Fixed

- Restarting FineCode services from the IDE now shuts down and reconnects more reliably.
- Action execution now sends the absolute project path instead of the project name.
- Action tree parsing now matches the updated FineCode LSP protocol payload structure.
- Test execution was updated for the newer FineCode API, including action-source based runs, structured test ids, and improved test tree rendering.
