import { describe, expect, test } from "bun:test";
import { PROJECT_ROOT } from "../config";
import { BASH_TOOL, READ_TOOL, WRITE_TOOL } from "./definitions";
import { runTool, safePath } from "./executor";

// the path check is a security boundary, so test the attacks, not just the happy path
describe("safePath", () => {
    test("resolves normal paths inside the project", () => {
        expect(safePath("src/App.tsx")).toBe(`${PROJECT_ROOT}/src/App.tsx`);
        expect(safePath("./src/../index.html")).toBe(`${PROJECT_ROOT}/index.html`);
    });

    test("rejects paths that climb out of the project", () => {
        expect(() => safePath("../../etc/passwd")).toThrow();
        expect(() => safePath("src/../../secret")).toThrow();
    });

    test("rejects absolute paths, even ones inside the project", () => {
        expect(() => safePath("/etc/passwd")).toThrow();
        expect(() => safePath(`${PROJECT_ROOT}/src/App.tsx`)).toThrow();
    });

    test("rejects a sibling folder that only shares the project's name prefix", () => {
        // "/tmp/tyox-project-evil" starts with "/tmp/tyox-project", which is why the check needs the trailing "/"
        expect(() => safePath("../tyox-project-evil/x")).toThrow();
    });

    test("rejects the project root itself and windows-style separators", () => {
        expect(() => safePath(".")).toThrow();
        expect(() => safePath("..\\..\\etc\\passwd")).toThrow();
    });
});

// these cases all fail before a sandbox is needed, so they run without e2b
describe("runTool", () => {
    test("returns an error result for an unknown tool instead of throwing", async () => {
        const result = await runTool("Delete_Everything", {}, "project-1", Date.now() + 60_000);
        expect(result.success).toBe(false);
        expect(result.output).toContain("Unknown tool");
    });

    test("returns an error result when the model sends invalid arguments", async () => {
        const missingPath = await runTool(READ_TOOL.name, {}, "project-1", Date.now() + 60_000);
        expect(missingPath.success).toBe(false);

        const wrongType = await runTool(WRITE_TOOL.name, { path: 42, content: "x" }, "project-1", Date.now() + 60_000);
        expect(wrongType.success).toBe(false);
    });

    test("refuses to run tests or the build, because tyox runs them itself", async () => {
        for (const commands of ["npm test", "npm run build", "bun run test", "npx tsc --noEmit", "vite build"]) {
            const result = await runTool(BASH_TOOL.name, { commands }, "project-1", Date.now() + 60_000);
            expect(result.success).toBe(false);
        }
    });
});
