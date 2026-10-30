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
   * Automated Image Generation via Google Flow PRO (Nano Banana 2.1)
   * Enters prompt, waits for generation, extracts full-res image (1600px) and saves to destPath.
   */
  async generateImageWithFlow(promptText, destPath) {
    if (!this.cookieStr) {
      throw new Error('GOOGLE_FLOW_COOKIE is not configured');
    }

    let browser;
    try {
      console.log(`[GoogleFlowService] 🚀 Launching automated Nano Banana 2.1 generation on Google Flow...`);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 }
      });

      // Parse cookies with secure: true
      const rawCookies = this.cookieStr.split(';').map(c => c.trim()).filter(Boolean);
      const validCookies = [];
      for (const c of rawCookies) {
        const eqIdx = c.indexOf('=');
        if (eqIdx > 0) {
          const name = c.slice(0, eqIdx).trim();
          const value = c.slice(eqIdx + 1).trim();
          validCookies.push({ name, value, domain: '.google.com', path: '/', secure: true, sameSite: 'None' });
        }
      }
      await context.addCookies(validCookies);

      const page = await context.newPage();
      const projectUrl = `https://flow.google.com/project/${this.projectId}`;
      await page.goto(projectUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 40000
      });

      const inputSelector = 'div.ProseMirror[aria-label="Bạn muốn tạo những gì?"]';
      await page.waitForSelector(inputSelector, { timeout: 20000 });

      // Get initial latest media ID
      const initialMediaId = await page.evaluate(() => {
        const firstImg = document.querySelector('flow-image-tile img');
        return firstImg ? firstImg.getAttribute('data-media-id') || firstImg.src : null;
      });

      console.log(`[GoogleFlowService] Typing prompt into Nano Banana 2.1: "${promptText.slice(0, 70)}..."`);
      await page.click(inputSelector);
      await page.fill(inputSelector, promptText);
      await page.waitForTimeout(1000);

      // Click "Bắt đầu tạo"
      const submitBtn = await page.$('button[aria-label="Bắt đầu tạo"], button.generate-icon-button');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      console.log(`[GoogleFlowService] Generation submitted. Waiting for Nano Banana 2.1 to generate...`);

      // Poll for completion (up to 60 seconds)
      let generatedImgSrc = null;
      for (let poll = 0; poll < 20; poll++) {
        await page.waitForTimeout(3000);
        const checkResult = await page.evaluate((prevId) => {
          const firstTileImg = document.querySelector('flow-image-tile img');
          if (!firstTileImg) return null;
          const currentId = firstTileImg.getAttribute('data-media-id') || firstTileImg.src;
          if (currentId && currentId !== prevId && firstTileImg.src && !firstTileImg.src.includes('placeholder')) {
            return firstTileImg.src;
          }
          return null;
        }, initialMediaId);

        if (checkResult) {
          generatedImgSrc = checkResult;
          console.log(`[GoogleFlowService] ✨ Nano Banana 2.1 image generation completed on poll ${poll + 1}!`);
          break;
        }
      }

      if (!generatedImgSrc) {
        throw new Error('Google Flow generation timed out after 60 seconds');
      }

      // Download the 1600px image
      console.log(`[GoogleFlowService] Downloading high-resolution image to ${destPath}...`);
      const response = await axios.get(generatedImgSrc, {
        headers: {
          'Cookie': this.cookieStr,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        responseType: 'arraybuffer',
        timeout: 60000
      });

      fs.writeFileSync(destPath, Buffer.from(response.data));
      console.log(`[GoogleFlowService] ✨ Remastered image successfully saved (${response.data.length} bytes) to: ${destPath}`);
      return destPath;
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

