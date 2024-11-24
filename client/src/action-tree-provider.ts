import * as vscode from "vscode";
import { getLSClient } from "./extension";
import path from "path";


enum NodeType {
    DIRECTORY = 0,
    PACKAGE = 1,
    ACTION = 2,
    PRESET = 3,
};

type ActionTreeNode = {
    nodeId: string;
    name: string;
    nodeType: NodeType;
    subnodes: ActionTreeNode[];
};

type FinecodeGetActionsResponse = {
    nodes: ActionTreeNode[];
};

const actionNodeToAction = (node: ActionTreeNode): Action => {
    let state = vscode.TreeItemCollapsibleState.None;
    if (node.nodeType === NodeType.PACKAGE) {
        state = vscode.TreeItemCollapsibleState.Expanded;
    } else if (node.nodeType === NodeType.DIRECTORY) {
        // directories are shown only to be able to create a new packages in them. It happens not
        // so often, collapse by default
        state = vscode.TreeItemCollapsibleState.Collapsed;
    }
    return new Action(node.name, state, node.nodeId, node.nodeType);
};

export class FineCodeActionsProvider
    implements vscode.TreeDataProvider<Action> {
    private readonly _changeTreeData = new vscode.EventEmitter<
        Action | void | undefined | null
    >();
    public readonly onDidChangeTreeData = this._changeTreeData.event;
    private refreshing = false;
    // private loaded = false;
    private actions: FinecodeGetActionsResponse | undefined = undefined;
    private actionById: Record<string, ActionTreeNode> = {};

    constructor(private workspaceRoot: string) { }

    public async refresh() {
        console.log("Refresh actions tree items");
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        // this.loaded = false;
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

        const parentNodeId = element?.projectPath || "";
        // TODO: correctly recognized whether children are already loaded
        console.log(parentNodeId in this.actionById, this.actionById[parentNodeId], this.actionById, parentNodeId);
        if (parentNodeId in this.actionById) {
            return Promise.resolve(this.actionById[parentNodeId].subnodes.map(actionNodeToAction));
        } else {
            return new Promise((resolve, reject) => {
                this.getActions(element?.projectPath || "")
                    .then((getActionsResponse) => {
                        const actions = getActionsResponse.nodes.map((node) => {
                            return actionNodeToAction(node);
                        });
                        resolve(actions);
                    })
                    .catch((error) => {
                        reject(error);
                    });
            });
        }
    }

    private loadActions(parentNodeId: string): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(1);
            getLSClient().then((lsClient) => {
                console.log('1->', lsClient);
                lsClient
                    .sendRequest("finecode/getActions", {
                        // workspaceRoot: this.workspaceRoot,
                        parentNodeId
                    })
                    .then((response) => {
                        console.log('resp', response);
                        // TODO: investigate why this occurs: we get empty object at start
                        if (Object.keys(<FinecodeGetActionsResponse>response).length > 0) {
                            this.actions = <FinecodeGetActionsResponse>response;
                            // this.loaded = true;

                            const saveActionsById = (actions: ActionTreeNode[]): void => {
                                for (const action of actions) {
                                    this.actionById[action.nodeId] = action;
                                    saveActionsById(action.subnodes);
                                }
                            };
                            saveActionsById(this.actions.nodes);
                        } else {
                            this.actions = { nodes: [] };
                            // this.loaded = false;
                        }
                        resolve();
                    })
                    .catch((error) => reject(error));
            });
        });
    }

    private getActions(parentNodeId: string): Promise<FinecodeGetActionsResponse> {
        return new Promise((resolve, reject) => {
            // if (!this.loaded) {
            this.loadActions(parentNodeId)
                .then(() => resolve(<FinecodeGetActionsResponse>this.actions))
                .catch((error) => reject(error));
            // } else {
            //     resolve(<FinecodeGetActionsResponse>this.actions);
            // }
        });
    }
}

class Action extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly projectPath: string,
        public readonly actionType: NodeType
    ) {
        super(label, collapsibleState);
        this.projectPath = projectPath;
        this.actionType = actionType;
    }

    toJSON() {
        return {
            label: this.label,
            collapsibleState: this.collapsibleState,
            projectPath: this.projectPath,
        };
    }

    iconPath = {
        light: path.join(
            __filename,
            "..",
            "assets",
            "icons",
            "light",
            // TODO: folder / folder-opened doesn't change, investigate why
            (this.actionType === NodeType.PACKAGE) ? "package.svg" : ((this.actionType === NodeType.DIRECTORY) ? this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded ? "folder-opened.svg" : "folder.svg" : "symbol-event.svg")
        ),
        dark: path.join(
            __filename,
            "..",
            "assets",
            "icons",
            "dark",
            // TODO: folder / folder-opened doesn't change, investigate why
            (this.actionType === NodeType.PACKAGE) ? "package.svg" : ((this.actionType === NodeType.DIRECTORY) ? this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded ? "folder-opened.svg" : "folder.svg" : "symbol-event.svg")
        ),
    };

    contextValue = (this.actionType === NodeType.PACKAGE) ? "package" : this.actionType === NodeType.DIRECTORY ? "directory" : "action";
}
