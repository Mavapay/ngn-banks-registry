import * as dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { resolve } from "path";
dotenv.config();


const defaultSupportedFormats = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
  ];
class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

class FailedUploadError extends ImageProcessingError {}
class ImageValidationError extends ImageProcessingError {}
class ImageBankMatchError extends ImageProcessingError {}

interface ImageInfo {
  path: string;
  name: string;
  code: string | null;
  extension: string;
  size: number;
  sizeFormatted: string;
  type: string;
  isSupported: boolean;
  created: Date;
  modified: Date;
  isValidSize: boolean;
}

interface ProcessorOptions {
  supportedFormats?: string[];
  maxFileSize?: number;
  minFileSize?: number;
  banksFilePath?: string;
  r2Config?: R2Config;
  isCI: boolean;
}

interface ProcessOptions {
  verbose?: boolean;
}

interface ProcessResult {
  processed: number;
  results: ImageInfo[];
  total: number;
  imageProcessReport: Record<string, string[]>;
}

interface ImageProcessReport {
  skipped: { name: string; reason: string }[];
  failed_upload: string[];
  completed: string[];
}

interface ReportData {
  total: number;
  byType: Record<string, number>;
  totalSize: number;
  averageSize: number;
  largestFile: ImageInfo | null;
  smallestFile: ImageInfo | null;
  unsupported: number;
  invalidSize: number;
}

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  bucketName: string;
  publicDomain: string; // Custom domain if you have one
}

export class ImageProcessor {
  private supportedFormats: string[];
  private maxFileSize: number;
  private minFileSize: number;
  private mimeTypes: Record<string, string>;
  private banksFilePath: string;
  public banks: Bank[];
  private r2Config?: R2Config;
  private s3Client?: S3Client;
  private isCI: boolean;

  constructor(options: ProcessorOptions) {
    // this.banks = require("../_data/banks.json");
    this.banksFilePath = options.banksFilePath || resolve("./_data/banks.json");
    this.supportedFormats = options.supportedFormats || defaultSupportedFormats;
    this.maxFileSize = options.maxFileSize || 100 * 1024; // 100KB default
    this.minFileSize = options.minFileSize || 1024; // 1KB default

    this.isCI = options.isCI || false;
    this.r2Config = options.r2Config;
    this.s3Client = this.r2Config
      ? new S3Client({
          region: "auto",
          endpoint: `https://${this.r2Config.accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: this.r2Config.accessKeyId,
            secretAccessKey: this.r2Config.secretAccessKey,
          },
        })
      : undefined;

    // MIME type mappings
    this.mimeTypes = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
      ".ico": "image/x-icon",
      ".tiff": "image/tiff",
      ".tif": "image/tiff",
    };
  }

  async loadBanksData(): Promise<void> {
    try {
      const banksContent = await fs.readFile(this.banksFilePath, "utf8");
      this.banks = JSON.parse(banksContent);
      console.log(
        `✓ Loaded ${this.banks.length} banks from ${this.banksFilePath}`
      );
    } catch (error) {
      console.warn(
        `⚠️  Could not load banks file: ${(error as Error).message}`
      );
      throw error;
    }
  }

  extractCode(imagePath: string) {
    const code = imagePath.replace(/\.[^/.]+$/, "");
    try {
      parseInt(code);
    } catch (error) {
      return null;
    }
    return code;
  }
  /**
   * Get file data for a single image
   */
  async getImageInfo(imagePath: string): Promise<ImageInfo | null> {
    try {
      const stats = await fs.stat(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      const basename = path.basename(imagePath);
      const code = this.extractCode(basename);

      return {
        path: imagePath,
        name: basename,
        code,
        extension: ext,
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size),
        type: this.mimeTypes[ext] || "unknown",
        isSupported: this.supportedFormats.includes(ext),
        created: stats.birthtime,
        modified: stats.mtime,
        isValidSize:
          stats.size >= this.minFileSize && stats.size <= this.maxFileSize,
      };
    } catch (error) {
      console.error(`Error processing ${imagePath}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Get all image files from directory
   */
  async getAllImageFiles(directory: string, imageProcessReport: ImageProcessReport): Promise<string[]> {
    const imageFiles: string[] = [];

    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.supportedFormats.includes(ext)) {
            const fullPath = path.join(directory, entry.name);
            imageFiles.push(fullPath);
          } else {
            imageProcessReport.skipped.push({
              name: entry.name,
              reason: `⚠️  Unsupported format: ${ext}`,
            });
          }
        }
      }
    } catch (error) {
      console.error(
        `Error reading directory ${directory}:`,
        (error as Error).message
      );
    }

    return imageFiles;
  }

  /**
   * Process all images in directory
   */
  async processDirectory(directory: string, options: ProcessOptions = {}) {
    const { verbose = false } = options;

    console.log(`🔍 Scanning directory: ${directory}`);

    const imageProcessReport: ImageProcessReport = {
      skipped: [],
      failed_upload: [],
      completed: [],
    };

    const imageFiles = await this.getAllImageFiles(directory, imageProcessReport);

    if (imageFiles.length === 0) {
      console.log("❌ No supported image files found");
      return { processed: 0, results: [], total: 0, imageProcessReport };
    }

    console.log(`📁 Found ${imageFiles.length} supported image files`);

    const results: ImageInfo[] = [];
    let processed = 0;

    for (const imagePath of imageFiles) {
      const ImageInfo = await this.getImageInfo(imagePath);

      if (ImageInfo) {
        results.push(ImageInfo);

        if (verbose) {
          this.logImageInfo(ImageInfo);
        }

        // Perform your custom processing here
        const imageResult = await this.processImage(ImageInfo);
        if (imageResult instanceof Error) {
          if (imageResult instanceof ImageValidationError) {
            imageProcessReport.skipped.push({
              name: ImageInfo.name,
              reason: imageResult.message,
            });
            continue;
          }
          if (imageResult instanceof FailedUploadError) {
            imageProcessReport.failed_upload.push(ImageInfo.name);
            continue;
          }
          if (imageResult instanceof ImageBankMatchError) {
            imageProcessReport.skipped.push({
              name: ImageInfo.name,
              reason: imageResult.message,
            });
            continue;
          }
          imageProcessReport.skipped.push({
            name: ImageInfo.name,
            reason: imageResult.message,
          });
          continue;
        }

        processed++;
        imageProcessReport.completed.push(ImageInfo.name);
      }
    }

    console.log(`✅ Processed ${processed} images successfully`);

    return { processed, results, total: imageFiles.length, imageProcessReport };
  }

  async uploadToR2(imageInfo: ImageInfo): Promise<string | Error> {
    if (!this.s3Client || !this.r2Config) {
      console.error("R2 client not configured");
      return new Error("R2 client not configured");
    }

    try {
      const fileBuffer = await fs.readFile(imageInfo.path);

      // Generate a clean filename for R2
      const fileName = imageInfo.code;
      const key = `logo/${fileName}`;

      const uploadParams = {
        Bucket: this.r2Config.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: imageInfo.type,
        CacheControl: "public, max-age=31536000", // 1 year cache
      };

      await this.s3Client.send(new PutObjectCommand(uploadParams));

      // Generate public URL
      const publicUrl = `${this.r2Config.publicDomain}/${key}`;

      console.log(`✓ Uploaded: ${fileName} → ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      return new Error(
        `Failed to upload image to R2: ${error?.message ?? "Unknown error"}`
      );
    }
  }

  async processImage(ImageInfo: ImageInfo): Promise<string | Error> {
    if (!ImageInfo.isSupported) {
      console.warn(`⚠️  Unsupported format: ${ImageInfo.type}`);
      return new ImageValidationError(
        `⚠️  Unsupported format: ${ImageInfo.type}`
      );
    }

    if (!ImageInfo.code) {
      console.warn(`⚠️  No code found: ${ImageInfo.name}`);
      return new ImageBankMatchError(`⚠️  No code found: ${ImageInfo.name}`);
    }

    if (!ImageInfo.isValidSize) {
      if (ImageInfo.size > this.maxFileSize) {
        console.warn(
          `⚠️  File too large: ${ImageInfo.name} (${ImageInfo.sizeFormatted})`
        );
      } else {
        console.warn(
          `⚠️  File too small: ${ImageInfo.name} (${ImageInfo.sizeFormatted})`
        );
      }
      return new ImageValidationError(
        `⚠️  Invalid size: ${ImageInfo.name} (${ImageInfo.sizeFormatted})`
      );
    }

    const bankIndex = this.banks.findIndex(
      (bank) =>
        bank.code === ImageInfo.code || bank.nipBankCode === ImageInfo.code
    );

    if (bankIndex === -1) {
      console.warn(`⚠️  No bank found: ${ImageInfo.name}`);
      return new ImageBankMatchError(`⚠️  No bank found: ${ImageInfo.name}`);
    }

    const bankMatch = this.banks[bankIndex];

    ImageInfo.code = bankMatch.nipBankCode;

    // If icon is already set, return it
    if (bankMatch?.icon && !bankMatch?.icon.includes("default-image")) {
      console.info(`ℹ️  ${bankMatch.name} already has an icon`);
      return bankMatch.icon;
    }

    // If running CI, do not upload to R2, return icon URL as is
    if (this.isCI) {
      return bankMatch.icon;
    }

    // save file to external cloud storage
    const imageUrl = await this.uploadToR2(ImageInfo);

    if (imageUrl instanceof Error) {
      console.error(imageUrl.message);
      return new FailedUploadError(imageUrl.message);
    }

    this.banks[bankIndex].icon = imageUrl;
    return imageUrl;
  }

  /**
   * Generate summary report
   */
  generateReport(results: ImageInfo[]): ReportData {
    const report: ReportData = {
      total: results.length,
      byType: {},
      totalSize: 0,
      averageSize: 0,
      largestFile: null,
      smallestFile: null,
      unsupported: 0,
      invalidSize: 0,
    };

    results.forEach((img) => {
      // Count by type
      report.byType[img.type] = (report.byType[img.type] || 0) + 1;

      // Size calculations
      report.totalSize += img.size;

      if (!report.largestFile || img.size > report.largestFile.size) {
        report.largestFile = img;
      }

      if (!report.smallestFile || img.size < report.smallestFile.size) {
        report.smallestFile = img;
      }

      if (!img.isSupported) report.unsupported++;
      if (!img.isValidSize) report.invalidSize++;
    });

    report.averageSize =
      results.length > 0 ? report.totalSize / results.length : 0;

    return report;
  }

  /**
   * Print summary report
   */
  printReport(
    results: ImageInfo[],
    imageProcessReport: ImageProcessReport
  ): void {
    const report = this.generateReport(results);

    console.log("\n📊 PROCESSING REPORT");
    console.log("==================");
    console.log(`Total files processed: ${report.total}`);
    console.log(`Skipped: ${imageProcessReport.skipped.length}`);
    console.log(`Total size: ${this.formatFileSize(report.totalSize)}`);
    console.log(`Average size: ${this.formatFileSize(report.averageSize)}`);

    if (report.largestFile) {
      console.log(
        `Largest file: ${report.largestFile.name} (${report.largestFile.sizeFormatted})`
      );
    }

    if (report.smallestFile) {
      console.log(
        `Smallest file: ${report.smallestFile.name} (${report.smallestFile.sizeFormatted})`
      );
    }

    console.log("\n📈 By file type:");
    Object.entries(report.byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} files`);
    });

    if (report.unsupported > 0) {
      console.log(`\n⚠️  Unsupported files: ${report.unsupported}`);
    }

    if (report.invalidSize > 0) {
      console.log(`⚠️  Invalid size files: ${report.invalidSize}`);
    }

    if (imageProcessReport.skipped.length > 0) {
      console.log(`\n📌  Skipped: ${imageProcessReport.skipped.length} files`);
      console.log(imageProcessReport.skipped);
    }

    if (imageProcessReport.failed_upload.length > 0) {
      console.log(
        `\n📌  Failed upload: ${imageProcessReport.failed_upload.length} files`
      );
      console.log(imageProcessReport.failed_upload);
    }
  }

  /**
   * Log individual image info
   */
  logImageInfo(ImageInfo: ImageInfo): void {
    const status = ImageInfo.isSupported && ImageInfo.isValidSize ? "✓" : "⚠️";
    console.log(
      `${status} ${ImageInfo.name} | ${ImageInfo.type} | ${ImageInfo.sizeFormatted}`
    );
  }

  /**
   * Format file size helper
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  async cleanup(completedImages: string[]): Promise<Error | void> {
    console.log("\n🧹 Starting cleanup...");

    // Update banks.json file with default icons for missing ones
    const updatedBanks = this.banks.map((bank) => {
      return {
        ...bank,
        icon: bank.icon
          ? bank.icon
          : `${this.r2Config?.publicDomain}/logo/default-image`,
      };
    });

    try {
      // await fs.writeFile(
      //   this.banksFilePath,
      //   JSON.stringify(updatedBanks, null, 2)
      // );
      console.log(
        `✓ Updated ${this.banksFilePath} with ${updatedBanks.length} banks`
      );
    } catch (error) {
      return new Error(
        `Failed to write banks.json: ${(error as Error).message}`
      );
    }

    // Delete processed image files
    if (completedImages.length === 0) {
      console.log("ℹ️  No images to delete");
      return;
    }

    let deletedCount = 0;
    let failedCount = 0;

    console.log(`🗑️  Deleting ${completedImages.length} processed images...`);

    const dirPath = resolve("./_data/images");

    for (const imagePath of completedImages) {
      try {
        await fs.unlink(resolve(dirPath, imagePath));
        deletedCount++;
        console.log(`✓ Deleted: ${path.basename(imagePath)}`);
      } catch (error) {
        failedCount++;
        console.error(
          `❌ Failed to delete ${path.basename(imagePath)}: ${
            (error as Error).message
          }`
        );
      }
    }

    console.log(`\n📊 Cleanup Summary:`);
    console.log(`  ✓ Successfully deleted: ${deletedCount} files`);
    if (failedCount > 0) {
      return new Error(
        `Failed to delete ${failedCount} out of ${completedImages.length} files`
      );
    }

    console.log("✅ Cleanup completed successfully");
  }
}
