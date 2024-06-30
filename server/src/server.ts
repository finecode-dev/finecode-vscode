import {
    createConnection,
    // TextDocuments,
    // Diagnostic,
    // DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    // DocumentDiagnosticReportKind,
    // type DocumentDiagnosticReport,
} from "vscode-languageserver/node";
import fs from 'node:fs';
import { FinecodeGetActionsRequestType } from "./requests";
import * as workspaceManagerClient from './workspace-manager-client';
import { ChildProcessByStdio, spawn } from "child_process";
import { Readable, Writable } from "stream";

// import { TextDocument } from "vscode-languageserver-textdocument";

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
// const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let finecodeFound = false;
let workspaceManagerProcess: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
let workspaceManagerAddress: string | undefined = undefined;

const waitForConnection = (): Promise<null> => {
    return new Promise((resolve, reject) => {
        let retries = 0;
        const checkConnection = () => {
            if (!workspaceManagerAddress) {
                if (retries === 2000) {
                    reject();
                }
                setTimeout(checkConnection, 10);
                retries++;
            } else {
                resolve(null);
            }
        };
    });
};

const readFinecodeCommand = (filepath: string): string => {
    try {
        const data = fs.readFileSync(filepath, 'utf8');
        return data.split('\n')[0];
    } catch (err) {
        console.error(err);
    }
    return '';
};

const initWorkspaceManager = async (): Promise<undefined> => {
    let wsDir: string | undefined = undefined;
    let finecodeCmd: string | undefined = undefined;
    // TODO: handle errors
    const dirs = await connection.workspace.getWorkspaceFolders();
    if (!dirs) {
        return;
    }
    for (const dir of dirs) {
        const dirPath = dir.uri.replace('file://', '');
        const finecodeShPath = dirPath + '/finecode.sh';
        console.log('check ', finecodeShPath);
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

    if (finecodeFound && finecodeCmd) {
        const finecodeCmdSplit = (finecodeCmd as string).split(' ');
        workspaceManagerProcess = spawn(finecodeCmdSplit[0], [...finecodeCmdSplit.slice(1, finecodeCmdSplit.length), 'start-api'], { cwd: wsDir });
        console.log('start workspace manager');
        // TODO: handle error of start?
        workspaceManagerProcess.stdout.on('data', (data) => {
            console.log(data.toString());
        });
        workspaceManagerProcess.stderr.on('data', (data) => {
            const dataString = data.toString();
            if (dataString.includes('Start web socketify server:')) {
                const _workspaceManagerAddress = 'http://' + dataString.split(': ')[1];
                console.log('workspace manager address: ', workspaceManagerAddress);
                workspaceManagerClient.configure({ url: _workspaceManagerAddress as string });
                connection.workspace.getWorkspaceFolders().then((dirs) => {
                    const addRequests = dirs?.map((dirPath) => {
                        console.log('register workspace dir', dirPath);
                        return workspaceManagerClient.addWorkspaceDir({ dir_path: dirPath.uri.replace('file://', '') });
                    });
                    if (addRequests) {
                        Promise.all(addRequests).then(() => {
                            // address is used as flag of started workspace manager, set it after adding
                            // all workspace dirs
                            workspaceManagerAddress = _workspaceManagerAddress;
                        });
                    }
                    return;
                });
            }
            console.log('E', dataString);
        });
    }
};

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasDiagnosticRelatedInformationCapability = !!(
        capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true,
            },
            // diagnosticProvider: {
            //     interFileDependencies: false,
            //     workspaceDiagnostics: false,
            // },
            documentFormattingProvider: true
        },
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true,
            },
        };
    }

    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(
            DidChangeConfigurationNotification.type,
            undefined
        );
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders((_event) => {
            connection.console.log("Workspace folder change event received.");
            // TODO: update workspace dirs in workspace manager on their change
        });
    }

    initWorkspaceManager();
});

connection.onShutdown(() => {
    if (workspaceManagerProcess !== null) {
        workspaceManagerProcess.stdout.destroy();
        workspaceManagerProcess.stderr.destroy();
        workspaceManagerProcess.kill('SIGINT');
        console.log('kill workspace manager');
    }
});

// The example settings
interface ExampleSettings {
    maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    } else {
        globalSettings = <ExampleSettings>(
            (change.settings.languageServerExample || defaultSettings)
        );
    }
    // Refresh the diagnostics since the `maxNumberOfProblems` could have changed.
    // We could optimize things here and re-fetch the setting first can compare it
    // to the existing setting, but this is out of scope for this example.
    connection.languages.diagnostics.refresh();
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings);
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: "languageServerExample",
        });
        documentSettings.set(resource, result);
    }
    return result;
}

// Only keep settings for open documents
// documents.onDidClose((e) => {
//     documentSettings.delete(e.document.uri);
// });

// connection.languages.diagnostics.on(async (params) => {
//     const document = documents.get(params.textDocument.uri);
//     if (document !== undefined) {
//         return {
//             kind: DocumentDiagnosticReportKind.Full,
//             items: await validateTextDocument(document),
//         } satisfies DocumentDiagnosticReport;
//     } else {
//         // We don't know the document. We can either try to read it from disk
//         // or we don't report problems for it.
//         return {
//             kind: DocumentDiagnosticReportKind.Full,
//             items: [],
//         } satisfies DocumentDiagnosticReport;
//     }
// });

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// documents.onDidChangeContent((change) => {
//     validateTextDocument(change.document);
// });

// async function validateTextDocument(
//     textDocument: TextDocument
// ): Promise<Diagnostic[]> {
//     // In this simple example we get the settings for every validate run.
//     const settings = await getDocumentSettings(textDocument.uri);

//     // The validator creates diagnostics for all uppercase words length 2 and more
//     const text = textDocument.getText();
//     const pattern = /\b[A-Z]{2,}\b/g;
//     let m: RegExpExecArray | null;

//     let problems = 0;
//     const diagnostics: Diagnostic[] = [];
//     while (
//         (m = pattern.exec(text)) &&
//         problems < settings.maxNumberOfProblems
//     ) { 
//         problems++;
//         const diagnostic: Diagnostic = {
//             severity: DiagnosticSeverity.Warning,
//             range: {
//                 start: textDocument.positionAt(m.index),
//                 end: textDocument.positionAt(m.index + m[0].length),
//             },
//             message: `${m[0]} is all uppercase.`,
//             source: "ex",
//         };
//         if (hasDiagnosticRelatedInformationCapability) {
//             diagnostic.relatedInformation = [
//                 {
//                     location: {
//                         uri: textDocument.uri,
//                         range: Object.assign({}, diagnostic.range),
//                     },
//                     message: "Spelling matters",
//                 },
//                 {
//                     location: {
//                         uri: textDocument.uri,
//                         range: Object.assign({}, diagnostic.range),
//                     },
//                     message: "Particularly for names",
//                 },
//             ];
//         }
//         diagnostics.push(diagnostic);
//     }
//     return diagnostics;
// }

connection.onDidChangeWatchedFiles((_change) => {
    // Monitored files have change in VSCode
    connection.console.log("We received a file change event");
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
    (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        // The pass parameter contains the position of the text document in
        // which code complete got requested. For the example we ignore this
        // info and always provide the same completion items.
        return [
            {
                label: "TypeScript",
                kind: CompletionItemKind.Text,
                data: 1,
            },
            {
                label: "JavaScript",
                kind: CompletionItemKind.Text,
                data: 2,
            },
        ];
    }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    if (item.data === 1) {
        item.detail = "TypeScript details";
        item.documentation = "TypeScript documentation";
    } else if (item.data === 2) {
        item.detail = "JavaScript details";
        item.documentation = "JavaScript documentation";
    }
    return item;
});

connection.onDocumentFormatting((params) => {
    console.log(params);
    return [];
});

connection.onRequest(FinecodeGetActionsRequestType, async (params) => {
    if (!finecodeFound) {
        return {};
    }
    await waitForConnection();
    const actions = await workspaceManagerClient.getActionList();
    console.log('get actions');
    return actions; // { rootAction: '', actionsByPath: {} };
});

connection.onExecuteCommand(async (params) => {
    if (!finecodeFound) {
        return;
    }
    if (params.command === '') {
        await workspaceManagerClient.runAction(); // TODO
    }
    console.log('execute command', params.command);
});

// Make the text document manager listen on the connection
// for open, change and close text document events
// documents.listen(connection);

// Listen on the connection
connection.listen();
