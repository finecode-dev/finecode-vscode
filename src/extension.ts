import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    StreamInfo,
} from "vscode-languageclient/node";
import fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn } from 'node:child_process';
import { FineCodeActionsProvider, ActionTreeNode, FinecodeGetActionsResponse } from "./action-tree-provider";
import { createOutputChannel } from './logging';
import * as lsProtocol from "vscode-languageserver-protocol";
import { createTestController } from "./test-controller";


const lsClientsByFolder = new Map<string, LanguageClient>();
const lsProcessesByFolder = new Map<string, ReturnType<typeof spawn>>();
// Tracks folders currently being started to prevent duplicate concurrent startups.
const lsFoldersStarting = new Set<string>();
const FINECODE_MCP_PROVIDER_ID = 'finecode';
const DEV_WORKSPACE_PYTHON_DISPLAY_PATH = '.venvs/dev_workspace/bin/python (Linux/macOS) or .venvs\\dev_workspace\\Scripts\\python.exe (Windows)';

function getWorkspaceMode(): 'per-folder' | 'single' {
    return vscode.workspace.getConfiguration('finecode').get<'per-folder' | 'single'>('workspaceMode', 'per-folder');
}

function getDevWorkspacePythonPath(workspacePath: string): string {
    if (process.platform === 'win32') {
        return path.join(workspacePath, '.venvs', 'dev_workspace', 'Scripts', 'python.exe');
    }

    return path.join(workspacePath, '.venvs', 'dev_workspace', 'bin', 'python');
}

function getClientForActiveEditor(): LanguageClient | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
        if (folder) {
            const client = lsClientsByFolder.get(folder.uri.fsPath);
            if (client) { return client; }
        }
    }
    // Fall back to first available client
    const first = lsClientsByFolder.values().next();
    return first.done ? undefined : first.value;
}

function createFineCodeMcpServerDefinitionProvider(outputChannel: vscode.LogOutputChannel): {
    provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>;
    disposable: vscode.Disposable;
} {
    const onDidChangeMcpServerDefinitionsEmitter = new vscode.EventEmitter<void>();
    const workspaceFoldersChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        outputChannel.info('Workspace folders changed, refreshing FineCode MCP server definitions');
        onDidChangeMcpServerDefinitionsEmitter.fire();
    });

    const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
        onDidChangeMcpServerDefinitions: onDidChangeMcpServerDefinitionsEmitter.event,
        provideMcpServerDefinitions: () => {
            // Always start a single MCP server from the first workspace folder.
            // In per-folder mode, tools accept a required 'workspace_root' parameter
            // that the MCP server uses to route requests to the correct WM instance.
            // Tools available are those declared in the main worktree (known limitation).
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
                outputChannel.warn('FineCode MCP provider: no workspace folders available');
                return [];
            }

            const rootPath = folders[0].uri.fsPath;
            const pythonPath = getDevWorkspacePythonPath(rootPath);
            if (!fs.existsSync(pythonPath)) {
                outputChannel.warn(`FineCode MCP provider: no dev_workspace python in ${rootPath}. Expected path: ${DEV_WORKSPACE_PYTHON_DISPLAY_PATH}`);
                return [];
            }

            outputChannel.debug(`Providing FineCode MCP server definition for root workspace: ${rootPath}`);

            return [
                new vscode.McpStdioServerDefinition(
                    'FineCode',
                    pythonPath,
                    ['-m', 'finecode', 'start-mcp', `--workdir=${rootPath}`],
                ),
            ];
        },
        resolveMcpServerDefinition: (serverDefinition) => {
            return serverDefinition;
        },
    };

    const disposable = {
        dispose: () => {
            workspaceFoldersChangeDisposable.dispose();
            onDidChangeMcpServerDefinitionsEmitter.dispose();
        },
    };

    return {
        provider,
        disposable,
    };
}


export async function activate(context: vscode.ExtensionContext) {
    // Create output channel first so we can log everything
    const outputChannel = createOutputChannel("Finecode LSP Server");
    outputChannel.info('=== Finecode extension activation started ===');

    console.log(
        'Congratulations, your extension "finecode-vscode" is now active!'
    );

    // tree data provider
    const rootPath =
        vscode.workspace.workspaceFolders &&
            vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : ""; // : undefined; // TODO

    outputChannel.info(`Workspace root path: ${rootPath}`);
    const actionsProvider = new FineCodeActionsProvider(rootPath);

    const { provider: mcpServerDefinitionProvider, disposable: mcpProviderDisposable } = createFineCodeMcpServerDefinitionProvider(outputChannel);
    const mcpProviderRegistration = vscode.lm.registerMcpServerDefinitionProvider(
        FINECODE_MCP_PROVIDER_ID,
        mcpServerDefinitionProvider,
    );
    outputChannel.info('Registered FineCode MCP server definition provider');


    // task provider:
    // docs: https://code.visualstudio.com/api/extension-guides/task-provider
    // example: https://github.com/microsoft/vscode-extension-samples/tree/main/task-provider-sample
    const taskProviderConfig = {
        provideTasks: () => {
            // const testTasks: vscode.Task[] = [
            //     new vscode.Task(
            //         { type: "finecode", task: "lint" },
            //         vscode.TaskScope.Workspace, // TODO: workspace dir?
            //         "lint",
            //         "finecode",
            //         new vscode.ShellExecution("finecode lint")
            //     ),
            // ];

            // if (!rakePromise) {
            //     rakePromise = Promise.resolve(testTasks);
            // }
            // return rakePromise;
            return Promise.resolve([]);
        },
        resolveTask(_task: vscode.Task): vscode.Task | undefined {
            outputChannel.debug("resolve task", _task);
            return _task;
            // const task = _task.definition.task;
            // if (task) {
            //     // resolveTask requires that the same definition object be used.
            //     const definition: RakeTaskDefinition = <any>_task.definition;
            //     return new vscode.Task(
            //         definition,
            //         _task.scope ?? vscode.TaskScope.Workspace,
            //         definition.task,
            //         'rake',
            //         new vscode.ShellExecution(`rake ${definition.task}`),
            //     );
            // }
            // return undefined;
        },
    };

    outputChannel.info('Starting workspace manager...');
    await runWorkspaceManager(outputChannel, actionsProvider);

    createTestController(context, getLSClient);

    outputChannel.info('Registering commands and providers...');
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("fineCodeActions", actionsProvider),
        mcpProviderRegistration,
        mcpProviderDisposable,
        // In per-folder mode: lazily start the WM for a folder when its first file is opened.
        // Registered once here (not inside runWorkspaceManager) so restart doesn't double-register.
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (!editor || getWorkspaceMode() !== 'per-folder') { return; }
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!folder) { return; }
            await ensureFolderWorkspaceManager(folder.uri.fsPath, outputChannel, actionsProvider);
        }),
        vscode.commands.registerCommand('finecode.restartWorkspaceManager', async () => {
            outputChannel.info('Restarting workspace manager');
            await stopWorkspaceManager();
            runWorkspaceManager(outputChannel, actionsProvider);
        }),
        vscode.commands.registerCommand("finecode.refreshActions", () =>
            actionsProvider.refresh()
        ),
        vscode.tasks.registerTaskProvider("finecode", taskProviderConfig),
        outputChannel,
        vscode.commands.registerCommand("finecode.showEditorActions", async () => {
            const client = getClientForActiveEditor();
            if (client === undefined) {
                console.error("LS Client is not initialized");
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                console.log('no active editor');
                return;
            }

            if (!editor.selection.isEmpty) {
                // TODO: handle range
                console.log('actions on range are currently not supported');
                return;
            }

            const requestParams: lsProtocol.ExecuteCommandParams = {
                command: 'finecode.getActionsForPosition',
                arguments: [editor.selection.active]
            };

            let actions: FinecodeGetActionsResponse;
            try {
                actions = await client.sendRequest(lsProtocol.ExecuteCommandRequest.method, requestParams);
            } catch (err) {
                // TODO: show error
                return;
            }
            const items = actions.nodes.map(node => ({ label: node.name, command: node.nodeId }))
            const selectedItem = await vscode.window.showQuickPick(items);
            if (selectedItem !== undefined) {
                const nodeIdParts = selectedItem.command.split("::");
                const projectPath = nodeIdParts[0];
                const actionName = nodeIdParts[1];
                const runRequestParams: lsProtocol.ExecuteCommandParams = {
                    command: 'finecode.runAction',
                    arguments: [{ action: actionName, project: projectPath }]
                };

                console.log('selected, run', selectedItem);
                try {
                    await client.sendRequest(lsProtocol.ExecuteCommandRequest.method, runRequestParams);
                } catch (err) {
                    // TODO: show error
                    return;
                }
            }
        })
    );

    outputChannel.info('=== Finecode extension activation complete ===');
}

export async function deactivate() {
    await disconnectFromWorkspaceManager();
}

const startFolderWorkspaceManager = async (
    folderPath: string,
    outputChannel: vscode.LogOutputChannel,
    actionsProvider: FineCodeActionsProvider,
): Promise<void> => {
    const devWorkspacePythonPath = getDevWorkspacePythonPath(folderPath);
    outputChannel.info(`Checking for Python at: ${devWorkspacePythonPath}`);
    if (!fs.existsSync(devWorkspacePythonPath)) {
        outputChannel.warn(`Python not found at: ${devWorkspacePythonPath}. Expected: ${DEV_WORKSPACE_PYTHON_DISPLAY_PATH}`);
        return;
    }

    outputChannel.info(`Found dev_workspace Python at: ${devWorkspacePythonPath}`);

    const finecodeCmdSplit = devWorkspacePythonPath.split(' ');
    const logLevel = vscode.workspace.getConfiguration('finecode').get<string>('logLevel', 'INFO');
    const wmArgs = ['start-lsp', `--log-level=${logLevel}`, '--tcp'];
    if (process.env.FINECODE_DEBUG) {
        wmArgs.push('--debug');
    }
    const serverOptions: ServerOptions = () => new Promise<StreamInfo>((resolve, reject) => {
        const proc = spawn(
            finecodeCmdSplit[0],
            [...finecodeCmdSplit.slice(1), '-m', 'finecode.cli', ...wmArgs],
            { cwd: folderPath, detached: false, shell: false }
        );
        lsProcessesByFolder.set(folderPath, proc);

        let buf = '';
        let resolved = false;

        proc.stdout!.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            const match = buf.match(/port:(\d+)/);
            if (match && !resolved) {
                resolved = true;
                const port = parseInt(match[1], 10);
                outputChannel.info(`[${path.basename(folderPath)}] Connecting to LSP server on port ${port}`);
                const socket = net.connect({ port, host: '127.0.0.1' });
                socket.on('connect', () => resolve({ reader: socket, writer: socket }));
                socket.on('error', reject);
            }
        });

        proc.stderr!.on('data', (d: Buffer) => outputChannel.append(d.toString()));
        proc.on('error', reject);
        proc.on('exit', (code) => {
            if (!resolved) {
                reject(new Error(`LSP server exited (${code}) before sending port`));
            }
        });
    });

    outputChannel.info(`[${path.basename(folderPath)}] Starting language server with command: ${finecodeCmdSplit[0]}`);
    outputChannel.info(`Args: ${JSON.stringify([...finecodeCmdSplit.slice(1), '-m', 'finecode.cli', ...wmArgs])}`);

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "*" }],
        outputChannel: outputChannel,
        traceOutputChannel: outputChannel,
    };

    // Create the language client and start the client.
    const client = new LanguageClient(
        `finecodeServer_${path.basename(folderPath)}`,
        `Finecode LSP Server (${path.basename(folderPath)})`,
        serverOptions,
        clientOptions
    );

    lsClientsByFolder.set(folderPath, client);

    // Waiting on start is required, otherwise we get empty responses on first requests like action list.
    outputChannel.info(`[${path.basename(folderPath)}] Starting language client...`);
    try {
        await client.start();
        outputChannel.info(`[${path.basename(folderPath)}] Language server started successfully!`);
    } catch (error) {
        outputChannel.error(`[${path.basename(folderPath)}] Failed to start language server: ${error}`);
        lsClientsByFolder.delete(folderPath);
        throw error;
    }

    client.onRequest('editor/documentMeta', () => {
        console.log('editor/documentMeta request');
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            console.log('no active editor');
            throw new Error('No active text editor');
        }

        return {
            uri: activeEditor.document.uri
        };
    });

    // client.onRequest('editor/documentText', () => {
    //     console.log('editor/documentText request');
    //     const { document } = vscode.window.activeTextEditor || {};
    //     if (!document) {
    //         console.log('no active editor');
    //         return;
    //     }

    //     return { text: document.getText() };
    // });

    client.onRequest('ide/startDebugging', async (data) => {
        console.log('ide/startDebugging request', data);

        await vscode.debug.startDebugging(undefined, data);
    });

    client.onNotification('actionsNodes/changed', (data: ActionTreeNode) => {
        actionsProvider.updateItem(data);
    });
};

const ensureFolderWorkspaceManager = async (
    folderPath: string,
    outputChannel: vscode.LogOutputChannel,
    actionsProvider: FineCodeActionsProvider,
): Promise<void> => {
    if (lsClientsByFolder.has(folderPath) || lsFoldersStarting.has(folderPath)) {
        return;
    }
    lsFoldersStarting.add(folderPath);
    try {
        await startFolderWorkspaceManager(folderPath, outputChannel, actionsProvider);
    } finally {
        lsFoldersStarting.delete(folderPath);
    }
};

const runWorkspaceManager = async (outputChannel: vscode.LogOutputChannel, actionsProvider: FineCodeActionsProvider) => {
    if (!vscode.workspace.workspaceFolders) {
        outputChannel.error("No workspace folders found. Please open a workspace folder and restart the extension.");
        return;
    }

    outputChannel.info(`Found ${vscode.workspace.workspaceFolders.length} workspace folder(s)`);

    const mode = getWorkspaceMode();

    if (mode === 'single') {
        // Single mode: start one WM for the first workspace folder immediately.
        const firstFolder = vscode.workspace.workspaceFolders[0];
        await startFolderWorkspaceManager(firstFolder.uri.fsPath, outputChannel, actionsProvider);
        if (!lsClientsByFolder.has(firstFolder.uri.fsPath)) {
            outputChannel.error(`No dev_workspace found in workspace folders. Expected path: ${DEV_WORKSPACE_PYTHON_DISPLAY_PATH}`);
            outputChannel.error('Please create the virtual environment and restart the extension.');
        }
    } else {
        // Per-folder mode: start WMs lazily as files are opened in each folder.
        // The onDidChangeActiveTextEditor listener in activate() handles subsequent folders.
        // Start the WM for the currently active editor's folder right now if there is one.
        outputChannel.info('Per-folder mode: workspace managers start on demand when files are opened.');
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
            if (folder) {
                await ensureFolderWorkspaceManager(folder.uri.fsPath, outputChannel, actionsProvider);
            }
        }
    }
};


const disconnectFromWorkspaceManager = async () => {
    await Promise.all([...lsClientsByFolder.entries()].map(async ([folderPath, client]) => {
        try {
            await client.stop();
        } catch (error) {
            console.log(`Error stopping language client for ${folderPath}:`, error);
        }
    }));
    lsClientsByFolder.clear();

    for (const proc of lsProcessesByFolder.values()) {
        proc.kill();
    }
    lsProcessesByFolder.clear();
};

const stopWorkspaceManager = async () => {
    await Promise.all([...lsClientsByFolder.entries()].map(async ([folderPath, client]) => {
        try {
            await client.sendRequest('server/shutdown', {});
        } catch (error) {
            console.log(`Error sending shutdown request for ${folderPath}:`, error);
        }
        try {
            await client.stop();
        } catch (error) {
            console.log(`Error stopping language client for ${folderPath}:`, error);
        }
    }));
    lsClientsByFolder.clear();

    for (const proc of lsProcessesByFolder.values()) {
        proc.kill();
    }
    lsProcessesByFolder.clear();
};


export function getLSClient(): Promise<LanguageClient> {
    return new Promise((resolve) => {
        const resolveClient = () => {
            const client = getClientForActiveEditor();
            if (!client) {
                setTimeout(resolveClient, 100);
            } else {
                resolve(client);
            }
        };
        resolveClient();
    });
}
