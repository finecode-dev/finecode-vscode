import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import fs from 'node:fs';
import { FineCodeActionsProvider } from "./action-tree-provider";

let lsClient: LanguageClient | undefined;
let fineCodeTaskProvider: vscode.Disposable | undefined;


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

    await runWorkspaceManager();

    // tree data provider
    const rootPath =
        vscode.workspace.workspaceFolders &&
            vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : ""; // : undefined; // TODO
    const actionsProvider = new FineCodeActionsProvider(rootPath);
    vscode.window.registerTreeDataProvider("fineCodeActions", actionsProvider);

    // task provider:
    // docs: https://code.visualstudio.com/api/extension-guides/task-provider
    // example: https://github.com/microsoft/vscode-extension-samples/tree/main/task-provider-sample
    // let rakePromise: Thenable<vscode.Task[]> | undefined = undefined;
    fineCodeTaskProvider = vscode.tasks.registerTaskProvider("finecode", {
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
    });

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    // const disposable = vscode.commands.registerCommand(
    //     "finecode-vscode.helloWorld",
    //     () => {
    //         // The code you place here will be executed every time your command is executed
    //         // Display a message box to the user
    //         vscode.window.showInformationMessage("Hello World from FineCode!");
    //     }
    // );
    // context.subscriptions.push(disposable);

    context.subscriptions.push(
        vscode.commands.registerCommand('finecode.restartWorkspaceManager', async () => {
            console.log('Restarting workspace manager');
            stopWorkspaceManager();
            runWorkspaceManager();
        }),
        vscode.commands.registerCommand("finecode.refreshActions", () =>
            actionsProvider.refresh()
        ),
    );
}

export async function deactivate() {
    await stopWorkspaceManager();
    if (fineCodeTaskProvider) {
        fineCodeTaskProvider.dispose();
    }
}

const runWorkspaceManager = async () => {
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
        // synchronize: {
        //     // Notify the server about file changes to '.clientrc files contained in the workspace
        //     fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
        // },
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
