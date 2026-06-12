import { createHash } from "node:crypto";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Client } from "minio";

export interface StoredObject {
  bucket: string;
  objectKey: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.MINIO_BUCKET ?? "ai-vision-assets";
  private storageAvailable = false;
  private readonly client = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
  });

  async onModuleInit() {
    await this.ensureBucket().catch((error: unknown) => {
      this.storageAvailable = false;
      this.logger.warn(`MinIO is unavailable; vision analysis will continue without object storage. ${String(error)}`);
    });
  }

  async uploadVisionFrame(params: {
    sessionId: string;
    snapshotId: string;
    imageBase64: string;
    contentType?: string;
  }): Promise<StoredObject> {
    const contentType = params.contentType ?? this.detectContentType(params.imageBase64);
    const buffer = this.base64ToBuffer(params.imageBase64);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const objectKey = `sessions/${params.sessionId}/vision/${Date.now()}-${params.snapshotId}.jpg`;

    if (this.storageAvailable) {
      await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
        "Content-Type": contentType,
        "X-Amz-Meta-Sha256": sha256,
      });
    }

    return {
      bucket: this.bucket,
      objectKey: this.storageAvailable ? objectKey : "",
      contentType,
      bytes: buffer.length,
      sha256,
    };
  }

  async getPresignedUrl(objectKey: string, expirySeconds = 60 * 10) {
    return this.client.presignedGetObject(this.bucket, objectKey, expirySeconds);
  }

  private async ensureBucket() {
    const exists = await this.client.bucketExists(this.bucket).catch((error: unknown) => {
      this.logger.error(`Cannot connect to MinIO bucket check: ${String(error)}`);
      throw error;
    });

    if (!exists) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created MinIO bucket ${this.bucket}`);
    }

    this.storageAvailable = true;
  }

  private base64ToBuffer(imageBase64: string) {
    const [, data = imageBase64] = imageBase64.split(",");
    return Buffer.from(data, "base64");
  }

  private detectContentType(imageBase64: string) {
    const match = imageBase64.match(/^data:(.+);base64,/);
    return match?.[1] ?? "image/jpeg";
  }
}
