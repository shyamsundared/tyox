const runningProjects = new Set<string>();

export class ProjectBusyError extends Error {
    constructor() {
        super("This project is already running a task. Wait for it to finish before sending another.");
        this.name = "ProjectBusyError";
    }
}

// Covers the whole task, including initialization, edits, validation, and snapshots.
// Replicas need a shared lock; this guard protects one agent process.
export async function withProjectRun<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    if (runningProjects.has(projectId)) throw new ProjectBusyError();
    runningProjects.add(projectId);
    try {
        return await run();
    } finally {
        runningProjects.delete(projectId);
    }
}
