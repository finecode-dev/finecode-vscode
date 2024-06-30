import * as vscode from "vscode";
import { getLSClient } from "./extension";
import path from "path";

interface RawAction {
    name: string;
    projectPath: string;
    subactions: string[];
    isPackage: boolean;
}

interface GetActionsResponse {
    rootAction: string;
    actionsByPath: Record<string, RawAction>;
}

export class FineCodeActionsProvider
    implements vscode.TreeDataProvider<Action>
{
    private readonly _changeTreeData = new vscode.EventEmitter<
        Action | void | undefined | null
    >();
    public readonly onDidChangeTreeData = this._changeTreeData.event;
    private refreshing = false;
    private loaded = false;
    private actions: GetActionsResponse | undefined = undefined;

    constructor(private workspaceRoot: string) {}

    public async refresh() {
        console.log("Refresh actions tree items");
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        this.loaded = false;
        this.actions = undefined;
        // getChildren method makes request each time, so items will be updated
        // automatically
        this._changeTreeData.fire();
        this.refreshing = false;
    }

    getTreeItem(element: Action): vscode.TreeItem {
        console.log("get tree item", element);
        return element;
    }

    getChildren(element?: Action): Thenable<Action[]> {
        console.log("get children", element);
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage(
                "No actions in empty workspace"
            );
            return Promise.resolve([]);
        }

        return new Promise((resolve, reject) => {
            this.getActions()
                .then((getActionsResponse) => {
                    if (!element) {
                        const rootAction =
                            getActionsResponse.actionsByPath[
                                getActionsResponse.rootAction
                            ];
                        if (!rootAction) {
                            if (rootAction === "") {
                                resolve([]);
                            } else {
                                console.log(getActionsResponse.actionsByPath);
                                reject(
                                    new Error(
                                        `No action info ${getActionsResponse.rootAction}`
                                    )
                                );
                            }
                        } else {
                            resolve([
                                new Action(
                                    rootAction.name,
                                    vscode.TreeItemCollapsibleState.Expanded,
                                    rootAction ? rootAction.projectPath : "",
                                    rootAction ? rootAction.isPackage : false
                                ),
                            ]);
                        }
                    } else {
                        let actionPath = `${element.projectPath}`;
                        if (!element.isPackage) {
                            actionPath += `::${element.label}`;
                        }
                        const actionInfo =
                            getActionsResponse.actionsByPath[actionPath];
                        if (!actionInfo) {
                            console.log(
                                getActionsResponse.actionsByPath,
                                element
                            );
                            reject(
                                new Error(`Element not found: ${actionPath}`)
                            );
                        } else {
                            console.log(
                                "info",
                                actionInfo,
                                actionInfo.subactions
                            );
                            const result = actionInfo.subactions.map(
                                (actionName) => {
                                    const subactionInfo =
                                        getActionsResponse.actionsByPath[
                                            actionName
                                        ];
                                    if (!subactionInfo) {
                                        console.log(
                                            `Subaction info not found for ${actionName}`
                                        );
                                        return new Action(
                                            actionName + "<- error",
                                            vscode.TreeItemCollapsibleState.None,
                                            "",
                                            false
                                        );
                                    }
                                    console.log(
                                        "subaction info",
                                        subactionInfo
                                    );
                                    return new Action(
                                        subactionInfo.name,
                                        subactionInfo.isPackage ||
                                        subactionInfo.subactions.length > 0
                                            ? vscode.TreeItemCollapsibleState
                                                  .Collapsed
                                            : vscode.TreeItemCollapsibleState
                                                  .None,
                                        subactionInfo
                                            ? subactionInfo.projectPath
                                            : "",
                                        subactionInfo.isPackage
                                    );
                                }
                            );
                            console.log("res", result);
                            resolve(result);
                        }
                    }
                })
                .catch((error) => {
                    reject(error);
                });
        });
    }

    private loadActions(): Promise<void> {
        return new Promise((resolve, reject) => {
            getLSClient().then((lsClient) => {
                lsClient
                    .sendRequest("finecode/getActions", {
                        workspaceRoot: this.workspaceRoot,
                    })
                    .then((response) => {
                        this.actions = <GetActionsResponse>response;
                        this.loaded = true;
                        resolve();
                    })
                    .catch((error) => reject(error));
            });
        });
    }

    private getActions(): Promise<GetActionsResponse> {
        return new Promise((resolve, reject) => {
            if (!this.loaded) {
                this.loadActions()
                    .then(() => resolve(<GetActionsResponse>this.actions))
                    .catch((error) => reject(error));
            } else {
                resolve(<GetActionsResponse>this.actions);
            }
        });
    }
}

class Action extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly projectPath: string,
        public readonly isPackage: boolean
    ) {
        super(label, collapsibleState);
        this.projectPath = projectPath;
        this.isPackage = isPackage;
    }

    get currentFile(): string {
        return vscode.window.activeTextEditor?.document.uri.path || "";
    }

    toJSON() {
        return {
            label: this.label,
            collapsibleState: this.collapsibleState,
            projectPath: this.projectPath,
            currentFile: this.currentFile,
        };
    }

    iconPath = {
        light: path.join(
            __filename,
            "..",
            "assets",
            "icons",
            "light",
            this.isPackage ? "package.svg" : "symbol-event.svg"
        ),
        dark: path.join(
            __filename,
            "..",
            "assets",
            "icons",
            "dark",
            this.isPackage ? "package.svg" : "symbol-event.svg"
        ),
    };

    contextValue = this.isPackage ? "package" : "action";
}
