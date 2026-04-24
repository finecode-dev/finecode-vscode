// TODO:
//- debug tests
// - test tags
// - auto discover 
// oiy on changes in project
// - test coverage
import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import * as lsProtocol from "vscode-languageserver-protocol";


// ── Wire types ────────────────────────────────────────────────────────────────────

type Project = {
    name: string;   // short directory name
    path: string;   // absolute path — used as project identifier in runAction and to group test files
    status: string;
};

type RawResourceUri = string;

type RawTestId = {
    file_path: RawResourceUri;
    class_name: string | null;
    test_name: string | null;
    variant: string | null;
};

type RawTestItem = {
    test_id: RawTestId;
    display_name: string | null;
    file_path: RawResourceUri | null;
    line: number | null;        // 0-based (LSP convention)
    children: RawTestItem[];
};

type RawTestCaseResult = {
    test_id: RawTestId;
    outcome: "passed" | "failed" | "skipped" | "error";
    display_name: string | null;
    duration_seconds: number | null;
    message: string | null;
    file_path: RawResourceUri | null;
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

const LIST_TESTS_ACTION_SOURCE = "finecode_extension_api.actions.ListTestsAction";
const RUN_TESTS_ACTION_SOURCE = "finecode_extension_api.actions.RunTestsAction";

function errorToMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "string" && error.length > 0) {
        return error;
    }
    return String(error);
}

function extractFailureReason(resultJson: Record<string, unknown> | undefined): string | undefined {
    if (!resultJson) {
        return undefined;
    }

    const reasonKeys = ["error", "message", "detail", "stderr"];
    for (const key of reasonKeys) {
        const value = resultJson[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value;
        }
    }

    return undefined;
}

function normalizeTestId(value: RawTestId): string {
    const filePath = normalizeFilePath(value.file_path);
    const className = value.class_name ?? undefined;
    const testName = value.test_name ?? undefined;
    const variant = value.variant ?? "";
    const parts = [filePath, className, testName ? `${testName}${variant}` : undefined].filter(
        (part): part is string => typeof part === "string" && part.length > 0,
    );

    return parts.join("::");
}

function normalizeFilePath(value: RawResourceUri | null | undefined): string | undefined {
    if (typeof value === "string" && value.length > 0) {
        return value;
    }

    return undefined;
}

function toFileUri(value: RawResourceUri | null | undefined): vscode.Uri | undefined {
    const rawPath = normalizeFilePath(value);
    if (!rawPath) {
        return undefined;
    }
    if (rawPath.startsWith("file://")) {
        return vscode.Uri.parse(rawPath);
    }
    return vscode.Uri.file(rawPath);
}

function normalizePathForComparison(value: string): string {
    return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getRelativeFilePath(projectPath: string, filePath: string): string | undefined {
    const normalizedProjectPath = normalizePathForComparison(projectPath);
    const normalizedFilePath = normalizePathForComparison(filePath);

    if (!normalizedFilePath.startsWith(`${normalizedProjectPath}/`)) {
        return undefined;
    }

    return normalizedFilePath.slice(normalizedProjectPath.length + 1);
}

function ensurePathContainers(
    controller: vscode.TestController,
    projectItem: vscode.TestItem,
    projectPath: string,
    filePath: RawResourceUri | null,
    containersById: Map<string, vscode.TestItem>,
): vscode.TestItem {
    const uri = toFileUri(filePath);
    if (!uri) {
        return projectItem;
    }

    const relativeFilePath = getRelativeFilePath(projectPath, uri.fsPath);
    if (!relativeFilePath) {
        return projectItem;
    }

    const segments = relativeFilePath.split("/").filter((segment) => segment.length > 0);
    const directorySegments = segments.slice(0, -1);
    if (directorySegments.length === 0) {
        return projectItem;
    }

    let parent = projectItem;
    const builtSegments: string[] = [];

    for (const segment of directorySegments) {
        builtSegments.push(segment);
        const relativeDirectoryPath = builtSegments.join("/");
        const itemId = `path:${projectPath}:${relativeDirectoryPath}`;

        let container = containersById.get(itemId);
        if (!container) {
            container = controller.createTestItem(
                itemId,
                segment,
                vscode.Uri.file(path.join(projectPath, ...builtSegments)),
            );
            containersById.set(itemId, container);
            parent.children.add(container);
        }

        parent = container;
    }

    return parent;
}


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
    controller.items.replace([]);
    testItemById.clear();

    const client = await getLsClient();

    let batchResponse: RunBatchResponse;
    try {
        batchResponse = await client.sendRequest(lsProtocol.ExecuteCommandRequest.method, {
            command: "finecode.runBatch",
            arguments: [{ actions: [LIST_TESTS_ACTION_SOURCE], params: { file_paths: [] }, options: { resultFormats: ["json"] } }],
        });
    } catch (err) {
        const errMessage = errorToMessage(err);
        void vscode.window.showErrorMessage(
            `FineCode: failed to list tests from Workspace Manager. ${errMessage}`,
        );
        return;
    }
    const failedProjects: string[] = [];

    for (const [projectPath, actionResults] of Object.entries(batchResponse?.results ?? {})) {
        const projectName = projectPath.split("/").at(-1) ?? projectPath;
        const pathContainersById = new Map<string, vscode.TestItem>();
        const listTestsResult = actionResults[LIST_TESTS_ACTION_SOURCE];
        if (!listTestsResult) {
            failedProjects.push(`${projectName}: no ListTestsAction result`);
            continue;
        }

        if (listTestsResult.returnCode !== 0) {
            const reason = extractFailureReason(listTestsResult.resultByFormat?.json);
            failedProjects.push(reason ? `${projectName}: ${reason}` : `${projectName}: returnCode ${listTestsResult.returnCode}`);
            continue;
        }

        const rawTests = (listTestsResult?.resultByFormat?.json as { tests?: RawTestItem[] })?.tests ?? [];
        if (rawTests.length === 0) { continue; }

        const projectItem = controller.createTestItem(
            `project:${projectName}`,
            projectName,
            vscode.Uri.file(projectPath),
        );
        for (const raw of rawTests) {
            const parent = ensurePathContainers(
                controller,
                projectItem,
                projectPath,
                raw.file_path,
                pathContainersById,
            );
            parent.children.add(buildTestItem(controller, raw, testItemById));
        }
        controller.items.add(projectItem);
    }

    if (failedProjects.length > 0) {
        const details = failedProjects.slice(0, 3).join("; ");
        const suffix = failedProjects.length > 3 ? ` (+${failedProjects.length - 3} more)` : "";
        void vscode.window.showErrorMessage(
            `FineCode: list_tests failed for ${failedProjects.length} project(s). ${details}${suffix}`,
        );
    }
}

function buildTestItem(
    controller: vscode.TestController,
    raw: RawTestItem,
    testItemById: Map<string, vscode.TestItem>,
): vscode.TestItem {
    const normalizedTestId = normalizeTestId(raw.test_id);
    const uri = toFileUri(raw.file_path);
    const isFileLevelNode = raw.test_id.class_name === null && raw.test_id.test_name === null;
    const fileLevelLabel = isFileLevelNode && uri ? path.basename(uri.fsPath) : undefined;
    const label = fileLevelLabel ?? raw.display_name ?? normalizedTestId.split("::").at(-1) ?? normalizedTestId;
    const item = controller.createTestItem(normalizedTestId, label, uri);

    if (raw.line !== null && raw.line !== undefined) {
        item.range = new vscode.Range(raw.line, 0, raw.line, 0);
    }

    testItemById.set(normalizedTestId, item);

    const children = Array.isArray(raw.children) ? raw.children : [];
    for (const child of children) {
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
                        arguments: [{ action: RUN_TESTS_ACTION_SOURCE, project: project.path, params: { test_ids: testIds } }],
                    });
                } catch (err) {
                    for (const item of projectLeaves) {
                        run.errored(item, new vscode.TestMessage(String(err)));
                    }
                    return;
                }

                const rawResults = (response?.resultByFormat?.json as { test_results?: RawTestCaseResult[] })?.test_results ?? [];
                const resultById = new Map(rawResults.map((r) => [normalizeTestId(r.test_id), r]));

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
            const resultUri = toFileUri(result.file_path);
            if (resultUri && result.line !== null && result.line !== undefined) {
                msg.location = new vscode.Location(
                    resultUri,
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
            const resultUri = toFileUri(result.file_path);
            if (resultUri && result.line !== null && result.line !== undefined) {
                msg.location = new vscode.Location(
                    resultUri,
                    new vscode.Position(result.line, 0),
                );
            }
            run.errored(item, msg, durationMs);
            break;
        }
    }
}
