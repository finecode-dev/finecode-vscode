import { RequestType } from 'vscode-jsonrpc/node';

export type FinecodeAddWorkspaceDirRequest = {
  dir_path: string;
};
export type FinecodeAddWorkspaceDirResponse = {};

export type FinecodeGetActionsRequest = {
  // someArg: string;
};

export type NormalizedAction = {
  name: string;
  projectPath: string;
  subactions: string[];
  isPackage: boolean;
};

export type FinecodeGetActionsResponse = {
  rootAction: string;
  actionsByPath: Record<string, NormalizedAction>;
};

export const FinecodeGetActionsRequestType = new RequestType<
  // payload
  FinecodeGetActionsRequest,
  // return type
  FinecodeGetActionsResponse,
  void
>('finecode/getActions');
