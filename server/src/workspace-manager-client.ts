// unexpected errors in extension have unclear logs so that we don't even see in which service it
// happens. Add log on error in each service to avoid that
import { rpcUnaryUnaryCall, configure } from 'modapp-js/dist/rpc-json.js';
import { FinecodeGetActionsResponse, FinecodeAddWorkspaceDirRequest, FinecodeAddWorkspaceDirResponse, FinecodeGetActionsRequest, RunActionRequest, RunActionResponse } from './requests';

export const addWorkspaceDir = (requestData: FinecodeAddWorkspaceDirRequest): FinecodeAddWorkspaceDirResponse => {
    try {
        return rpcUnaryUnaryCall({ methodName: '/finecode/workspace_manager/workspacemanagerservice/addworkspacedir', requestData });
    } catch (error) {
        console.error("Adding workspace dir failed: ", error);
        throw error;
    }
};

export const getActionList = (requestData: FinecodeGetActionsRequest): FinecodeGetActionsResponse => {
    try {
        return rpcUnaryUnaryCall({ methodName: '/finecode/workspace_manager/workspacemanagerservice/listactions', requestData });
    } catch (error) {
        console.error("Gettings action list failed: ", error);
        throw error;
    }
};


export const runAction = (requestData: RunActionRequest): RunActionResponse => {
    try {
        return rpcUnaryUnaryCall({ methodName: '/finecode/workspace_manager/workspacemanagerservice/runaction', requestData: requestData });
    } catch (error) {
        console.error("Running action failed: ", error);
        throw error;
    }
};

export { configure };
