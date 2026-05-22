import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import r2Client, { R2_BUCKET } from '../config/r2.js';

const PRESIGNED_EXPIRY_SECONDS = 900; // 15 minutos

export async function generatePresignedUrl(r2Key) {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
  });

  return getSignedUrl(r2Client, command, { expiresIn: PRESIGNED_EXPIRY_SECONDS });
}
