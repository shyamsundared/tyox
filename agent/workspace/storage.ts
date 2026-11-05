import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import type { Sandbox } from "e2b";
import { PROJECT_ROOT } from "../config";
import { timeLeft } from "../utils";

const ARCHIVE_PATH = "/tmp/tyox-project-snapshot.tar.gz";
const TAR_TIMEOUT_MS = 90_000;
// node_modules gets reinstalled and .env files should never be stored
const EXCLUDED = ["node_modules", ".git", "dist", ".vite", "coverage", ".env", ".env.*", "*.log"];

const bucket = process.env.S3_BUCKET;
const prefix = process.env.S3_PREFIX || "tyox/projects";
const endpoint = process.env.S3_ENDPOINT;

const s3 = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    // the endpoint is only set when using local rustfs instead of real s3
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 90_000 },
});

function snapshotKey(projectId: string): string {
    return `${prefix}/${projectId}/workspace.tar.gz`;
}

export function isStorageEnabled(): boolean {
    return Boolean(bucket);
}

export async function saveProjectSnapshot(sandbox: Sandbox, projectId: string, deadline: number) {
    if (!bucket) return;

    const excludes = EXCLUDED.map((pattern) => `--exclude='${pattern}'`).join(" ");
    await sandbox.commands.run(`tar -czf ${ARCHIVE_PATH} ${excludes} -C ${PROJECT_ROOT} .`, {
        timeoutMs: timeLeft(deadline, TAR_TIMEOUT_MS),
    });

    const bytes = await sandbox.files.read(ARCHIVE_PATH, { format: "bytes" });
    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: snapshotKey(projectId),
        Body: Buffer.from(bytes),
        ContentType: "application/gzip",
    }));
}

// returns false if there is nothing saved for this project yet
export async function restoreProjectSnapshot(sandbox: Sandbox, projectId: string, deadline: number): Promise<boolean> {
    if (!bucket) return false;

    let body;
    try {
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: snapshotKey(projectId) }));
        body = response.Body;
    } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return false;
        throw error;
    }
    if (!body) throw new Error("The saved project snapshot was empty.");

    const bytes = await body.transformToByteArray();
    await sandbox.files.write(ARCHIVE_PATH, new Blob([new Uint8Array(bytes)]));
    await sandbox.commands.run(`tar -xzf ${ARCHIVE_PATH} --no-same-owner -C ${PROJECT_ROOT}`, {
        timeoutMs: timeLeft(deadline, TAR_TIMEOUT_MS),
    });
    return true;
}
