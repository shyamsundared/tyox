import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;

if (!endpoint) {
    throw new Error("Set S3_ENDPOINT to the local MinIO URL before creating a bucket.");
}

if (!bucket) {
    throw new Error("Set S3_BUCKET to the bucket name before creating a bucket.");
}

const client = new S3Client({
    endpoint,
    region: process.env.AWS_REGION || "us-east-1",
    forcePathStyle: true,
});

try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created MinIO bucket: ${bucket}`);
} catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") {
        console.log(`MinIO bucket already exists: ${bucket}`);
    } else {
        throw error;
    }
} finally {
    client.destroy();
}
