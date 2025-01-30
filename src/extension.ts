import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import fs from 'node:fs';
import { FineCodeActionsProvider, ActionTreeNode, FinecodeGetActionsResponse } from "./action-tree-provider";
import { createOutputChannel } from './logging';
import * as lsProtocol from "vscode-languageserver-protocol";


let lsClient: LanguageClient | undefined;


const readFinecodeCommand = (filepath: string): string => {
    try {
        const data = fs.readFileSync(filepath, 'utf8');
        return data.split('\n')[0];
    } catch (err) {
        console.error(err);
    }
    return '';
};

export async function activate(context: vscode.ExtensionContext) {
    console.log(
        'Congratulations, your extension "finecode-vscode" is now active!'
    );

    // tree data provider
    const rootPath =
        vscode.workspace.workspaceFolders &&
            vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : ""; // : undefined; // TODO
    const actionsProvider = new FineCodeActionsProvider(rootPath);


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
            console.log("resolve", _task);
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

    // default output channel causes multiple loggers on restart of language server. Use own one
    // to avoid this problem
    const outputChannel = createOutputChannel("Finecode LSP Server");
    await runWorkspaceManager(outputChannel, actionsProvider);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("fineCodeActions", actionsProvider),
        vscode.commands.registerCommand('finecode.restartWorkspaceManager', async () => {
            console.log('Restarting workspace manager');
            stopWorkspaceManager();
            runWorkspaceManager(outputChannel, actionsProvider);
        }),
        vscode.commands.registerCommand("finecode.refreshActions", () =>
            actionsProvider.refresh()
        ),
        vscode.tasks.registerTaskProvider("finecode", taskProviderConfig),
        outputChannel,
        vscode.commands.registerCommand("finecode.showEditorActions", async () => {
            if (lsClient === undefined) {
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
                actions = await lsClient.sendRequest(lsProtocol.ExecuteCommandRequest.method, requestParams);
            } catch (err) {
                // TODO: show error
                return;
            }
            const items = actions.nodes.map(node => ({ label: node.name, command: node.nodeId}))
            const selectedItem = await vscode.window.showQuickPick(items);
            if (selectedItem !== undefined) {
                const runRequestParams: lsProtocol.ExecuteCommandParams = {
                    command: 'finecode.runAction',
                    arguments: [editor.selection.active]
                };

                console.log('selected, run', selectedItem);
                try {
                    await lsClient.sendRequest(lsProtocol.ExecuteCommandRequest.method, runRequestParams);
                } catch (err) {
                    // TODO: show error
                    return;
                }
            }
        })
    );
}

export async function deactivate() {
    await stopWorkspaceManager();
}

const runWorkspaceManager = async (outputChannel: vscode.LogOutputChannel, actionsProvider: FineCodeActionsProvider) => {
    if (!vscode.workspace.workspaceFolders) {
        console.log("No workspace folders, add one and restart extension. Autoreload is not supported yet");
        return;
    }

    let finecodeCmd: string | undefined = undefined;
    let wsDir: string | undefined = undefined;
    let finecodeFound = false;
    for (const folder of vscode.workspace.workspaceFolders) {
        const dirPath = folder.uri.path;
        const finecodeShPath = dirPath + '/finecode.sh';
        if (fs.existsSync(finecodeShPath)) {
            finecodeCmd = readFinecodeCommand(finecodeShPath);
            if (finecodeCmd !== '') {
                wsDir = dirPath;
                finecodeFound = true;
            } else {
                console.log('finecode command is empty');
            }
        }
        break;
    }

    if (!finecodeFound) {
        console.log('No finecode.sh found in workspace folders. Add one and restart the extension.  Autoreload is not supported yet');
        return;
    }

    const finecodeCmdSplit = (finecodeCmd as string).split(' ');
    const serverOptions: ServerOptions = {
        command: finecodeCmdSplit[0],
        args: [...finecodeCmdSplit.slice(1), '-m', 'finecode.workspace_manager.cli', 'start-api', '--trace'], // , '--debug'
        options: { cwd: wsDir, detached: false, shell: true },
        transport: TransportKind.stdio
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // TODO: dynamic or for all?
        documentSelector: [{ scheme: "file", language: "python" }],
        outputChannel: outputChannel,
        traceOutputChannel: outputChannel,
    };

    // Create the language client and start the client.
    lsClient = new LanguageClient(
        'finecodeServer',
        'Finecode LSP Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    // waiting on start server is required, otherwise we will get empty response on first request
    // like action list
    await lsClient.start();

    lsClient.onRequest('editor/documentMeta', () => {
        console.log('editor/documentMeta request');
        const { document } = vscode.window.activeTextEditor || {};
        if (!document) {
            console.log('no active editor');
            return;
        }

        return {
            uri: document.uri
        };
    });

    lsClient.onRequest('editor/documentText', () => {
        console.log('editor/documentText request');
        const { document } = vscode.window.activeTextEditor || {};
        if (!document) {
            console.log('no active editor');
            return;
        }

        return { text: document.getText() };
    });

    lsClient.onNotification('actionsNodes/changed', (data: ActionTreeNode) => {
        actionsProvider.updateItem(data);
    });
};


const stopWorkspaceManager = async () => {
    if (lsClient) {
        await lsClient.stop();
        lsClient = undefined;
    }
};


export function getLSClient(): Promise<LanguageClient> {
    return new Promise((resolve) => {
        const resolveClient = () => {
            if (!lsClient) {
                setTimeout(resolveClient, 100);
            } else {
                resolve(lsClient);
            }
        };
        resolveClient();
    });
}
