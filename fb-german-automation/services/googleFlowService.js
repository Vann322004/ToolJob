import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

/**
 * Google Flow PRO (Nano Banana 2.1 / BELUGA) Automation Service
 * Supports:
 * 1. Resolving shared image links from Google Flow (https://flow.google.com/shared/image/...)
 * 2. Automated headless image generation via Google Flow project
 */
export class GoogleFlowService {
  constructor() {
    this.projectId = process.env.GOOGLE_FLOW_PROJECT_ID || '00a64f80-e60a-4ebf-9529-e30396745ee2';
    this.cookieStr = process.env.GOOGLE_FLOW_COOKIE || '';
  }

  isConfigured() {
    return Boolean(this.cookieStr);
  }

  /**
   * Extract high-resolution image URL from a Google Flow shared link
   * @param {string} sharedUrl - e.g. https://flow.google.com/shared/image/10b3dc7f-...
   * @returns {Promise<string|null>} - Direct image URL (flow-content.google)
   */
  async resolveSharedImageUrl(sharedUrl) {
    let browser;
    try {
      console.log(`[GoogleFlowService] Resolving Google Flow image from: ${sharedUrl}...`);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      
      await page.goto(sharedUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      const images = await page.$$eval('img', (imgs) =>
        imgs.map((i) => ({
          src: i.src,
          width: i.naturalWidth,
          height: i.naturalHeight
        }))
      );

      // Filter for the main flow content image (flow-content.google)
      const flowImg = images.find(
        (img) => img.src.includes('flow-content.google') && img.width >= 500
      ) || images.find((img) => img.src.includes('flow-content.google'));

      if (flowImg) {
        console.log(`[GoogleFlowService] ✨ Resolved direct image URL: ${flowImg.src.slice(0, 80)}...`);
        return flowImg.src;
      }

      return null;
    } catch (err) {
      console.error(`[GoogleFlowService] Error resolving shared image: ${err.message}`);
      return null;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  /**
   * Download image directly to local file
   */
  async downloadImage(imageUrl, destPath) {
    const res = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    fs.writeFileSync(destPath, Buffer.from(res.data));
    console.log(`[GoogleFlowService] Remastered image downloaded successfully (${res.data.length} bytes) to ${destPath}`);
    return destPath;
  }
}

export const googleFlowService = new GoogleFlowService();
