import {
    createConnection,
    // TextDocuments,
    // Diagnostic,
    // DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    // CompletionItem,
    // CompletionItemKind,
    // TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    ExecuteCommandParams,
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
// let finecodeFound = false;
let workspaceManagerProcess: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
let workspaceManagerAddress: string | undefined = undefined;
let keepRunningUntilDisconnectStream: any | null = null;

const waitForConnection = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        let retries = 0;
        const checkConnection = () => {
            if (!workspaceManagerAddress) {
                if (retries === 300) {
                    reject();
                }
                setTimeout(checkConnection, 100);
                retries++;
            } else {
                resolve();
            }
        };
        checkConnection();
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

const checkLogForServerStart = (logLine: string): void => {
    // NOTE: subprocesses can print the same start logs as the main process, check logs only until
    // main process starts
    if (logLine.includes('Start server:')) {
        const _workspaceManagerAddress = 'http://' + logLine.split('server: ')[1].split('\n')[0];
        console.log('workspace manager address: ', _workspaceManagerAddress);
        workspaceManagerClient.configure({ url: _workspaceManagerAddress as string });
        connection.workspace.getWorkspaceFolders().then((dirs) => {
            const addRequests = dirs?.map((dirPath) => {
                const addWorkspaceDirPayload = { dirPath: dirPath.uri.replace('file://', '') };
                console.log('add workspace dir', addWorkspaceDirPayload);
                try {
                    return workspaceManagerClient.addWorkspaceDir(addWorkspaceDirPayload);
                } catch (error) {
                    console.error('---->', error);
                    return error;
                }
            });
            if (addRequests) {
                Promise.all(addRequests).then(async () => {
                    // address is used as flag of started workspace manager, set it after adding
                    // all workspace dirs
                    workspaceManagerAddress = _workspaceManagerAddress;
                    console.log('dirs successfully registered');
                    keepRunningUntilDisconnectStream = await workspaceManagerClient.keepRunningUntilDisconnect({});
                    console.log("start 'keep running until disconnect' stream");
                });
            }
            return;
        });
    }
};

const initWorkspaceManager = async (): Promise<undefined> => {
    console.log('Init workspace manager');
    let wsDir: string | undefined = undefined;
    let finecodeCmd: string | undefined = undefined;
    let finecodeFound = false;
    // TODO: handle errors
    const dirs = await connection.workspace.getWorkspaceFolders();
    if (!dirs) {
        console.log('No workspace dirs');
        return;
    }
    console.log('Workspace dirs: ', dirs);
    for (const dir of dirs) {
        const dirPath = dir.uri.replace('file://', '');
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

    if (finecodeFound && finecodeCmd) {
        const finecodeCmdSplit = (finecodeCmd as string).split(' ');
        workspaceManagerProcess = spawn(finecodeCmdSplit[0], [...finecodeCmdSplit.slice(1, finecodeCmdSplit.length), 'start-api'], { cwd: wsDir });
        console.log('start workspace manager in', wsDir);
        // TODO: handle error of start?
        workspaceManagerProcess.stdout.on('data', (data) => {
            const dataString = data.toString();
            console.log(dataString);
            if (!workspaceManagerAddress) {
                checkLogForServerStart(dataString);
            }
        });
        workspaceManagerProcess.stderr.on('data', (data) => {
            const dataString = data.toString();
            if (!workspaceManagerAddress) {
                checkLogForServerStart(dataString);
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
            // completionProvider: {
            //     resolveProvider: true,
            // },
            // diagnosticProvider: {
            //     interFileDependencies: false,
            //     workspaceDiagnostics: false,
            // },
            // documentFormattingProvider: true,
            
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
    if (keepRunningUntilDisconnectStream !== null) {
        console.log("end 'keep running until disconnect' stream");
        keepRunningUntilDisconnectStream.end();
    }
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

// function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
//     if (!hasConfigurationCapability) {
//         return Promise.resolve(globalSettings);
//     }
//     let result = documentSettings.get(resource);
//     if (!result) {
//         result = connection.workspace.getConfiguration({
//             scopeUri: resource,
//             section: "languageServerExample",
//         });
//         documentSettings.set(resource, result);
//     }
//     return result;
// }

// Only keep settings for open documents
// documents.onDidClose((e) => {
//     documentSettings.delete(e.document.uri);
// });

connection.onDidChangeWatchedFiles((_change) => {
    // Monitored files have change in VSCode
    connection.console.log("We received a file change event");
});

// connection.onDocumentFormatting((params) => {
//     // TODO: call format action
//     console.log(params);
//     return [];
// });

connection.onRequest(FinecodeGetActionsRequestType, async (params) => {
    try {
        await waitForConnection();
    } catch {
        console.log('No connection to workspace manager');
        return;
    }

    console.log('->', params);
    try {
        const actions = await workspaceManagerClient.getActionList(params);
        console.log('got actions', actions);
        return actions;
    } catch (error) {
        console.error(error);
        throw error;
    }
});

connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
    try {
        await waitForConnection();
    } catch {
        console.log('No connection to workspace manager');
        return;
    }

    console.log('execute command', params.command, params.arguments);
    if (params.command === 'finecode.runActionOnFile' || params.command === 'finecode.runActionOnProject') {
        if (params.arguments === undefined) {
            console.error("Unexpected: no arguments in command");
            return;
        }
        const actionNodeId = params.arguments[0];
        let applyOn = '';
        let applyOnText = '';
        if (params.command === 'finecode.runActionOnFile') {
            applyOn = params.arguments[1];
            applyOnText = params.arguments.length > 1 ? params.arguments[2] : "";
        } else if (params.command === "finecode.runActionOnProject") {
            applyOn = actionNodeId.split('::')[0];
        }
        try {
            const result = await workspaceManagerClient.runAction({ actionNodeId, applyOn, applyOnText });
            return result;
        } catch (error) {
            console.log("Action running error", error);
            return null;
        }
    }
    console.log('execute command - not found');
});

// Make the text document manager listen on the connection
// for open, change and close text document events
// documents.listen(connection);

// Listen on the connection
connection.listen();
