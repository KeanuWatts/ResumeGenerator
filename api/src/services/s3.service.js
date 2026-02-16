import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.AWS_S3_BUCKET || "resumegen-exports";
const region = process.env.AWS_REGION || "us-east-1";
const endpoint = process.env.AWS_ENDPOINT || undefined;
/** When set (e.g. http://localhost:9000), presigned URLs use this so the browser can download. */
const publicEndpoint = process.env.AWS_PUBLIC_ENDPOINT || undefined;
const expiresIn = 7 * 24 * 60 * 60;

function getClient(usePublicEndpoint = false) {
  const config = {
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  };
  const ep = usePublicEndpoint && publicEndpoint ? publicEndpoint : endpoint;
  if (ep) config.forcePathStyle = true;
  if (ep) config.endpoint = ep;
  return new S3Client(config);
}

/**
 * Ensure bucket exists; create if not (e.g. MinIO on first run).
 */
export async function ensureBucket() {
  const client = getClient();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (err.name === "NotFound" || err.Code === "NoSuchBucket" || err.$metadata?.httpStatusCode === 404) {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } else {
      throw err;
    }
  }
}

/**
 * Upload buffer to S3 and return presigned download URL.
 * @param {string} key - Object key (e.g. "exports/userId/docId.pdf")
 * @param {Buffer} body - PDF bytes
 * @param {string} contentType - e.g. "application/pdf"
 * @returns {Promise<{ url: string, key: string, expiresAt: Date }>}
 */
export async function uploadPdf(key, body, contentType = "application/pdf") {
  const client = getClient(false);
  await ensureBucket();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const signClient = publicEndpoint ? getClient(true) : client;
  const url = await getSignedUrl(
    signClient,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  );
  return { url, key, expiresAt };
}
