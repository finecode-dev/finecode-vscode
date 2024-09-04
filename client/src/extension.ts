// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as path from "path";
import {
    ExecuteCommandParams,
    ExecuteCommandRequest,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import { FineCodeActionsProvider } from "./action-tree-provider";

let lsClient: LanguageClient | undefined;
let fineCodeTaskProvider: vscode.Disposable | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log(
        'Congratulations, your extension "finecode-vscode" is now active!'
    );

    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
        path.join("dist", "server.js")
    );
    console.log(serverModule);

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
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

    // tree data provider
    const rootPath =
        vscode.workspace.workspaceFolders &&
        vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : ""; // : undefined; // TODO
    const actionsProvider = new FineCodeActionsProvider(rootPath);
    vscode.window.registerTreeDataProvider("fineCodeActions", actionsProvider);
    vscode.commands.registerCommand("finecode.refreshActions", () =>
        actionsProvider.refresh()
    );

    vscode.commands.registerCommand("finecode.runActionOnProject", (args) => {
        const executeCommandParams: ExecuteCommandParams = {
            command: 'finecode.runActionOnProject',
            arguments: [args.projectPath]
        };
        lsClient?.sendRequest(ExecuteCommandRequest.type, executeCommandParams);
    });

    vscode.commands.registerCommand("finecode.runActionOnFile", (args) => {
        const executeCommandParams: ExecuteCommandParams = {
            command: 'finecode.runActionOnFile',
            arguments: [args.projectPath, vscode.window.activeTextEditor?.document.uri.path]
        };
        lsClient?.sendRequest(ExecuteCommandRequest.type, executeCommandParams);
    });

    // task provider:
    // docs: https://code.visualstudio.com/api/extension-guides/task-provider
    // example: https://github.com/microsoft/vscode-extension-samples/tree/main/task-provider-sample
    let rakePromise: Thenable<vscode.Task[]> | undefined = undefined;
    fineCodeTaskProvider = vscode.tasks.registerTaskProvider("finecode", {
        provideTasks: () => {
            const testTasks: vscode.Task[] = [
                new vscode.Task(
                    { type: "finecode", task: "lint" },
                    vscode.TaskScope.Workspace, // TODO: workspace dir?
                    "lint",
                    "finecode",
                    new vscode.ShellExecution("finecode lint")
                ),
            ];

            if (!rakePromise) {
                rakePromise = Promise.resolve(testTasks);
            }
            return rakePromise;
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
    const disposable = vscode.commands.registerCommand(
        "finecode-vscode.helloWorld",
        () => {
            // The code you place here will be executed every time your command is executed
            // Display a message box to the user
            vscode.window.showInformationMessage("Hello World from FineCode!");
        }
    );

    context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export async function deactivate() {
    if (lsClient) {
        await lsClient.stop();
    }
    if (fineCodeTaskProvider) {
        fineCodeTaskProvider.dispose();
    }
}

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
