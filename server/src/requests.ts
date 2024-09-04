import { RequestType } from 'vscode-jsonrpc/node';

export type FinecodeAddWorkspaceDirRequest = {
  dirPath: string;
};
export type FinecodeAddWorkspaceDirResponse = {};

export type FinecodeGetActionsRequest = {
  parentNodeId: string
};

export enum NodeType {
  DIRECTORY = 0,
  PACKAGE = 1,
  ACTION = 2,
  PRESET = 3,
};

export type ActionTreeNode = {
  nodeId: string;
  name: string;
  nodeType: NodeType;
  subnodes: ActionTreeNode[];
};

export type FinecodeGetActionsResponse = {
  nodes: ActionTreeNode[];
};

export const FinecodeGetActionsRequestType = new RequestType<
  // payload
  FinecodeGetActionsRequest,
  // return type
  FinecodeGetActionsResponse,
  void
>('finecode/getActions');


export type RunActionRequest = {
  actionNodeId: string;
  applyOn: string;
};

export type RunActionResponse = {};
