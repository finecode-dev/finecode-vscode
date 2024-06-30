import { rpcUnaryUnaryCall, configure } from 'modapp-js/dist/rpc-json.js';
import { FinecodeGetActionsResponse, FinecodeAddWorkspaceDirRequest, FinecodeAddWorkspaceDirResponse } from './requests';

export const addWorkspaceDir = (requestData: FinecodeAddWorkspaceDirRequest): FinecodeAddWorkspaceDirResponse => {
    return rpcUnaryUnaryCall({ methodName: '/finecode/workspace_manager/workspacemanagerservice/addworkspacedir', requestData });
};

export const getActionList = (): FinecodeGetActionsResponse => {
    return rpcUnaryUnaryCall({ methodName: '/finecode/workspace_manager/workspacemanagerservice/getactionlist', requestData: {} });
};


export const runAction = () => {
    return rpcUnaryUnaryCall({ methodName: '/finecode/workspace_manager/workspacemanagerservice/runaction', requestData: {} });
};

export { configure };
