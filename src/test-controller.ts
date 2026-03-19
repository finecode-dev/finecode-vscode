// TODO:
//- debug tests
// - test tags
// - auto discover 
// oiy on changes in project
// - test coverage
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import * as lsProtocol from "vscode-languageserver-protocol";


// ── Wire types ────────────────────────────────────────────────────────────────────

type Project = {
    name: string;   // short directory name — used as project identifier in runAction
    path: string;   // absolute path — used to group test files back to their project
    status: string;
};

type RawTestItem = {
    test_id: string;
    display_name: string | null;
    file_path: string | null;
    line: number | null;        // 0-based (LSP convention)
    children: RawTestItem[];
};

type RawTestCaseResult = {
    test_id: string;
    outcome: "passed" | "failed" | "skipped" | "error";
    display_name: string | null;
    duration_seconds: number | null;
    message: string | null;
    file_path: string | null;
    line: number | null;        // 0-based
};

type RunActionResponse = {
    resultByFormat: {
        json: Record<string, unknown>;
    };
    returnCode: number;
};

type BatchActionResult = {
    resultByFormat: {
        json: Record<string, unknown>;
    };
    returnCode: number;
};

type RunBatchResponse = {
    results: Record<string, Record<string, BatchActionResult>>;
    returnCode: number;
};


// ── Public API ────────────────────────────────────────────────────────────────────

export function createTestController(
    context: vscode.ExtensionContext,
    getLsClient: () => Promise<LanguageClient>,
): vscode.TestController {
    const controller = vscode.tests.createTestController("finecode", "FineCode");
    context.subscriptions.push(controller);

    // Flat map of test_id → TestItem, used when mapping run results back
    const testItemById = new Map<string, vscode.TestItem>();

    controller.resolveHandler = async (_item) => {
        // Always load the full tree — no lazy per-item expansion needed
        await discoverAllTests(controller, getLsClient, testItemById);
    };

    controller.refreshHandler = async (_token) => {
        await discoverAllTests(controller, getLsClient, testItemById);
    };

    controller.createRunProfile(
        "Run",
        vscode.TestRunProfileKind.Run,
        (request, token) => runTests(controller, request, token, getLsClient),
        /* isDefault */ true,
    );

    return controller;
}


// ── Project list ──────────────────────────────────────────────────────────────────

async function fetchProjects(client: LanguageClient): Promise<Project[]> {
    try {
        const result: Project[] = await client.sendRequest(lsProtocol.ExecuteCommandRequest.method, {
            command: "finecode.listProjects",
            arguments: [],
        });
        return (result ?? []).filter((p) => p.status === "CONFIG_VALID");
    } catch {
        return [];
    }
}


// ── Discovery ─────────────────────────────────────────────────────────────────────

async function discoverAllTests(
    controller: vscode.TestController,
    getLsClient: () => Promise<LanguageClient>,
    testItemById: Map<string, vscode.TestItem>,
): Promise<void> {
    console.log("[FineCode] discoverAllTests: started");
    controller.items.replace([]);
    testItemById.clear();

    const client = await getLsClient();
    console.log("[FineCode] discoverAllTests: LSP client obtained, sending runBatch list_tests");

    let batchResponse: RunBatchResponse;
    try {
        batchResponse = await client.sendRequest(lsProtocol.ExecuteCommandRequest.method, {
            command: "finecode.runBatch",
            arguments: [{ actions: ["list_tests"], params: { file_paths: [] }, options: { resultFormats: ["json"] } }],
        });
        console.log("[FineCode] discoverAllTests: runBatch response received, projects:", Object.keys(batchResponse?.results ?? {}));
    } catch (err) {
        console.error("[FineCode] discoverAllTests: runBatch failed:", err);
        return;
    }

    for (const [projectPath, actionResults] of Object.entries(batchResponse?.results ?? {})) {
        const listTestsResult = actionResults["list_tests"];
        console.log(`[FineCode] discoverAllTests: project=${projectPath} returnCode=${listTestsResult?.returnCode} hasJson=${!!listTestsResult?.resultByFormat?.json}`);
        const rawTests = (listTestsResult?.resultByFormat?.json as { tests?: RawTestItem[] })?.tests ?? [];
        if (rawTests.length === 0) { continue; }

        const projectName = projectPath.split("/").at(-1) ?? projectPath;
        const projectItem = controller.createTestItem(
            `project:${projectName}`,
            projectName,
            vscode.Uri.file(projectPath),
        );
        for (const raw of rawTests) {
            projectItem.children.add(buildTestItem(controller, raw, testItemById));
        }
        controller.items.add(projectItem);
    }
}

function buildTestItem(
    controller: vscode.TestController,
    raw: RawTestItem,
    testItemById: Map<string, vscode.TestItem>,
): vscode.TestItem {
    const label = raw.display_name ?? raw.test_id.split("::").at(-1) ?? raw.test_id;
    const uri = raw.file_path ? vscode.Uri.file(raw.file_path) : undefined;
    const item = controller.createTestItem(raw.test_id, label, uri);

    if (raw.line !== null && raw.line !== undefined) {
        item.range = new vscode.Range(raw.line, 0, raw.line, 0);
    }

    testItemById.set(raw.test_id, item);

    for (const child of raw.children) {
        item.children.add(buildTestItem(controller, child, testItemById));
    }

    return item;
}


// ── Execution ─────────────────────────────────────────────────────────────────────

async function runTests(
    controller: vscode.TestController,
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    getLsClient: () => Promise<LanguageClient>,
): Promise<void> {
    const run = controller.createTestRun(request);
    const client = await getLsClient();
    const projects = await fetchProjects(client);

    // Collect leaf items to run
    const leaves: vscode.TestItem[] = [];
    const scope = request.include && request.include.length > 0
        ? request.include
        : [...collectTopLevel(controller)];

    for (const item of scope) {
        collectLeaves(item, leaves);
    }

    for (const item of leaves) {
        run.started(item);
    }

    // Group leaves by project, then run each project in parallel
    const leavesByProject = groupLeavesByProject(leaves, projects);

    try {
        await Promise.all(
            [...leavesByProject.entries()].map(async ([project, projectLeaves]) => {
                if (token.isCancellationRequested) { return; }

                const testIds = projectLeaves.map((i) => i.id);
                let response: RunActionResponse;
                try {
                    response = await client.sendRequest(lsProtocol.ExecuteCommandRequest.method, {
                        command: "finecode.runAction",
                        arguments: [{ action: "run_tests", project: project.name, params: { test_ids: testIds } }],
                    });
                } catch (err) {
                    for (const item of projectLeaves) {
                        run.errored(item, new vscode.TestMessage(String(err)));
                    }
                    return;
                }

                const rawResults = (response?.resultByFormat?.json as { test_results?: RawTestCaseResult[] })?.test_results ?? [];
                const resultById = new Map(rawResults.map((r) => [r.test_id, r]));

                for (const item of projectLeaves) {
                    const result = resultById.get(item.id);
                    if (!result) {
                        run.skipped(item);
                    } else {
                        applyResult(run, item, result);
                    }
                }
            })
        );
    } finally {
        run.end();
    }
}

function collectTopLevel(controller: vscode.TestController): vscode.TestItem[] {
    const items: vscode.TestItem[] = [];
    controller.items.forEach((item) => items.push(item));
    return items;
}

function collectLeaves(item: vscode.TestItem, out: vscode.TestItem[]): void {
    if (item.children.size === 0) {
        out.push(item);
    } else {
        item.children.forEach((child) => collectLeaves(child, out));
    }
}

function groupLeavesByProject(
    leaves: vscode.TestItem[],
    projects: Project[],
): Map<Project, vscode.TestItem[]> {
    const map = new Map<Project, vscode.TestItem[]>();

    for (const item of leaves) {
        const filePath = item.uri?.fsPath ?? "";
        // Find the project whose path is the longest prefix of the file path
        let matched = projects[0];
        for (const project of projects) {
            if (
                filePath.startsWith(project.path) &&
                (!matched || project.path.length > matched.path.length)
            ) {
                matched = project;
            }
        }
        if (!matched) { continue; }

        const bucket = map.get(matched) ?? [];
        bucket.push(item);
        map.set(matched, bucket);
    }

    return map;
}

function applyResult(
    run: vscode.TestRun,
    item: vscode.TestItem,
    result: RawTestCaseResult,
): void {
    const durationMs = result.duration_seconds !== null && result.duration_seconds !== undefined
        ? result.duration_seconds * 1000
        : undefined;

    switch (result.outcome) {
        case "passed":
            run.passed(item, durationMs);
            break;
        case "failed": {
            const msg = new vscode.TestMessage(result.message ?? "Test failed");
            if (result.file_path && result.line !== null && result.line !== undefined) {
                msg.location = new vscode.Location(
                    vscode.Uri.file(result.file_path),
                    new vscode.Position(result.line, 0),
                );
            }
            run.failed(item, msg, durationMs);
            break;
        }
        case "skipped":
            run.skipped(item);
            break;
        case "error": {
            const msg = new vscode.TestMessage(result.message ?? "Test error");
            if (result.file_path && result.line !== null && result.line !== undefined) {
                msg.location = new vscode.Location(
                    vscode.Uri.file(result.file_path),
                    new vscode.Position(result.line, 0),
                );
            }
            run.errored(item, msg, durationMs);
            break;
        }
    }
}
