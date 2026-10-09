import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CommandExitError, type Sandbox } from "e2b";
import { remainingTimeout, withDeadline } from "./deadline";
import { PROJECT_ROOT } from "./project-paths";

const ARCHIVE_PATH_PREFIX = "/tmp/tyox-project-snapshot-";
const STORAGE_REQUEST_TIMEOUT_MS = 90_000;

let s3: S3Client | undefined;

function bucketName(): string | undefined {
    return process.env.S3_BUCKET?.trim() || undefined;
}

function objectKey(projectId: string): string {
    const prefix = (process.env.S3_PREFIX || "tyox/projects").replace(/^\/+|\/+$/g, "");
    return `${prefix}/${projectId}/workspace.tar.gz`;
}

function getS3Client(): S3Client {
    if (!s3) {
        const endpoint = process.env.S3_ENDPOINT;
        s3 = new S3Client({
            region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
            ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        });
    }
    return s3;
}

function quotePath(path: string): string {
    return `'${path.replaceAll("'", "'\\''")}'`;
}

async function runSandboxCommand(sandbox: Sandbox, command: string, deadlineAt: number): Promise<void> {
    const result = await withDeadline(sandbox.commands.run(command, {
        cwd: PROJECT_ROOT,
        timeoutMs: remainingTimeout(deadlineAt, STORAGE_REQUEST_TIMEOUT_MS),
    }), deadlineAt);
    if (result.exitCode !== 0) {
        const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
        throw new Error(`Project snapshot command failed${detail ? `: ${detail}` : ` with exit code ${result.exitCode}`}`);
    }
}

function isMissingObject(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const details = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return details.name === "NoSuchKey" || details.name === "NotFound" || details.$metadata?.httpStatusCode === 404;
}

export function isProjectStorageEnabled(): boolean {
    return bucketName() !== undefined;
}

export async function saveProjectSnapshot(
    sandbox: Sandbox,
    projectId: string,
    deadlineAt: number,
): Promise<string | null> {
    const bucket = bucketName();
    if (!bucket) return null;

    const archivePath = `${ARCHIVE_PATH_PREFIX}${randomUUID()}.tar.gz`;
    const quotedArchivePath = quotePath(archivePath);
    const exclusions = ["node_modules", ".git", "dist", ".vite", "coverage", ".env", ".env.*", "*.log"]
        .map((pattern) => `--exclude=${quotePath(pattern)}`)
        .join(" ");

    try {
        await runSandboxCommand(
            sandbox,
            `tar -czf ${quotedArchivePath} ${exclusions} -C ${quotePath(PROJECT_ROOT)} .`,
            deadlineAt,
        );
        const bytes = await withDeadline(sandbox.files.read(archivePath, { format: "bytes" }), deadlineAt);
        const key = objectKey(projectId);
        const response = await withDeadline(getS3Client().send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: Buffer.from(bytes),
            ContentType: "application/gzip",
            Metadata: { projectid: projectId, savedat: new Date().toISOString() },
        })), deadlineAt);
        return response.VersionId ?? new Date().toISOString();
    } finally {
        await sandbox.files.remove(archivePath).catch(() => {});
    }
}

export async function restoreProjectSnapshot(
    sandbox: Sandbox,
    projectId: string,
    deadlineAt: number,
): Promise<boolean> {
    const bucket = bucketName();
    if (!bucket) return false;

    let response;
    try {
        response = await withDeadline(getS3Client().send(new GetObjectCommand({
            Bucket: bucket,
            Key: objectKey(projectId),
        })), deadlineAt);
    } catch (error) {
        if (isMissingObject(error)) return false;
        throw new Error(`Could not load the saved S3 project snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.Body) throw new Error("The saved S3 project snapshot was empty.");

    const archivePath = `${ARCHIVE_PATH_PREFIX}${randomUUID()}.tar.gz`;
    try {
        const bytes = await withDeadline(response.Body.transformToByteArray(), deadlineAt);
        await withDeadline(sandbox.files.write(archivePath, bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer), deadlineAt);
        await runSandboxCommand(
            sandbox,
            `tar -xzf ${quotePath(archivePath)} --no-same-owner -C ${quotePath(PROJECT_ROOT)}`,
            deadlineAt,
        );
        return true;
    } catch (error) {
        if (error instanceof CommandExitError) {
            throw new Error(`Could not restore the saved S3 project snapshot: ${error.stderr || error.stdout || error.message}`);
        }
        throw error;
    } finally {
        await sandbox.files.remove(archivePath).catch(() => {});
    }
}
