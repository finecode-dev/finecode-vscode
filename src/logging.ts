import * as vscode from "vscode";
import * as util from "util";


type Arguments = unknown[];
class OutputChannelLogger {
    constructor(private readonly channel: vscode.LogOutputChannel) { }

    public traceLog(...data: Arguments): void {
        this.channel.appendLine(util.format(...data));
    }

    public traceError(...data: Arguments): void {
        this.channel.error(util.format(...data));
    }

    public traceWarn(...data: Arguments): void {
        this.channel.warn(util.format(...data));
    }

    public traceInfo(...data: Arguments): void {
        this.channel.info(util.format(...data));
    }

    public traceVerbose(...data: Arguments): void {
        this.channel.debug(util.format(...data));
    }
}

let channel: OutputChannelLogger | undefined;
export function registerLogger(logChannel: vscode.LogOutputChannel): Disposable {
    channel = new OutputChannelLogger(logChannel);
    return {
        [Symbol.dispose]: () => {
            channel = undefined;
        },
    };
}

export function createOutputChannel(name: string): vscode.LogOutputChannel {
    return vscode.window.createOutputChannel(name, { log: true });
}
