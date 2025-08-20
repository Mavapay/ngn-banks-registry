// runs in pull_request CI
import * as dotenv from "dotenv";
import { ImageProcessor } from './workflow';
dotenv.config();

async function main() {
  const directory = process.env.IMAGE_DIRECTORY || "./_data/images";

  const processor = new ImageProcessor({
    maxFileSize: 100 * 1024, // 100KB
    minFileSize: 1024, // 1KB
    isCI: process.env.CI === "true",
  });

  try {
    await processor.loadBanksData();

    const { imageProcessReport } = await processor.processDirectory(directory, {
      verbose: false, // CI should not be verbose
    });

    // Check if any images failed validation
    if (imageProcessReport.skipped.length > 0) {
      // allow default-image to pass
      const invalidImages = imageProcessReport.skipped.filter((image) => image.name !== "default-image.png");

      if (invalidImages.length > 0) {
        console.error("❌ Some images failed validation:");
        console.log(invalidImages)
        process.exit(1);
      }
    }

    if (imageProcessReport.completed.length === 0) {
      console.error("❌ No new images to process")
      process.exit(1);
    }

    console.log("✅ All images are valid.");
  } catch (error) {
    console.error("❌ CI script failed:", (error as Error).message);
    process.exit(1);
  }
}

// Run the CI script
main();