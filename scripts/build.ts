import * as dotenv from "dotenv";
import { ImageProcessor, R2Config } from "./workflow";
dotenv.config();


// CLI usage
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const directory = args[0] || "./_data/images";

  const r2Config: R2Config = {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    accountId: process.env.R2_ACCOUNT_ID || "",
    bucketName: process.env.R2_BUCKET_NAME || "",
    publicDomain: process.env.R2_PUBLIC_DOMAIN || "",
  };

  const isCI = process.env.CI === "true";

  // Validate R2 config
  if (!isCI) {
    // ensure all required environment variables are set if not running in CI
    if (
      !r2Config.accessKeyId ||
      !r2Config.secretAccessKey ||
      !r2Config.accountId ||
      !r2Config.bucketName ||
      !r2Config.publicDomain
    ) {
      console.error(
        "❌ Missing R2 configuration. Please set environment variables:"
      );
      console.error(
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN"
      );
      process.exit(1);
    }
  }

  const processor = new ImageProcessor({
    maxFileSize: 5 * 1024 * 1024, // 5MB
    minFileSize: 1024, // 1KB
    r2Config,
    isCI,
  });

  try {
    await processor.loadBanksData();
    const { results, imageProcessReport } = await processor.processDirectory(
      directory,
      {
        verbose: process.env.CI ? false : true, // Less verbose in CI
      }
    );

    processor.printReport(results, imageProcessReport);

    if (imageProcessReport.completed.length > 0) {
      const cleanupError = await processor.cleanup(
        imageProcessReport.completed
      );
      if (cleanupError instanceof Error) {
        console.error("❌ Cleanup failed:", cleanupError.message);
        process.exit(1);
      }
    }
  } catch (error) {
    console.error("❌ Script failed:", (error as Error).message);
    process.exit(1);
  }
}

// Run if called directly
main();
