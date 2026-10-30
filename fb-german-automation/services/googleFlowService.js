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
    this.activeBrowser = null;
    this.activePage = null;
    this._queue = Promise.resolve();
  }

  isConfigured() {
    return Boolean(this.cookieStr);
  }

  /**
   * Acquire persistent warmed Google Flow page to avoid restarting Chromium each time
   */
  async _getOrCreateSession() {
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }

    console.log(`[GoogleFlowService] ⚡ Pre-warming persistent Google Flow browser session...`);
    this.activeBrowser = await chromium.launch({ headless: true });
    const context = await this.activeBrowser.newContext({
      viewport: { width: 1440, height: 900 }
    });

    const rawCookies = this.cookieStr.split(';').map((c) => c.trim()).filter(Boolean);
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

    this.activePage = await context.newPage();
    const projectUrl = `https://flow.google.com/project/${this.projectId}`;
    await this.activePage.goto(projectUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 40000
    });

    const inputSelector = 'div.ProseMirror[aria-label="Bạn muốn tạo những gì?"]';
    await this.activePage.waitForSelector(inputSelector, { timeout: 25000 });
    return this.activePage;
  }

  /**
   * Automated Image Generation via Google Flow PRO (Nano Banana 2.1)
   * Enters prompt, waits for generation, extracts full-res image (1600px) and saves to destPath.
   */
  async generateImageWithFlow(promptText, destPath) {
    if (!this.cookieStr) {
      throw new Error('GOOGLE_FLOW_COOKIE is not configured');
    }

    // Mutex lock to prevent simultaneous session conflicts
    return new Promise((resolve, reject) => {
      this._queue = this._queue
        .then(async () => {
          let page;
          try {
            console.log(`[GoogleFlowService] 🚀 Running Nano Banana 2.1 generation (Warmed Session)...`);
            page = await this._getOrCreateSession();

            const inputSelector = 'div.ProseMirror[aria-label="Bạn muốn tạo những gì?"]';
            await page.waitForSelector(inputSelector, { timeout: 15000 });

            // Get initial latest media ID
            const initialMediaId = await page.evaluate(() => {
              const firstImg = document.querySelector('flow-image-tile img');
              return firstImg ? firstImg.getAttribute('data-media-id') || firstImg.src : null;
            });

            console.log(`[GoogleFlowService] Typing prompt: "${promptText.slice(0, 70)}..."`);
            await page.click(inputSelector);
            await page.fill(inputSelector, promptText);
            await page.waitForTimeout(600);

            // Click "Bắt đầu tạo"
            const submitBtn = await page.$('button[aria-label="Bắt đầu tạo"], button.generate-icon-button');
            if (submitBtn) {
              await submitBtn.click();
            } else {
              await page.keyboard.press('Enter');
            }

            console.log(`[GoogleFlowService] Generation submitted to Google Cloud. Awaiting render...`);

            // Rapid poll for completion (every 1.5s)
            let generatedImgSrc = null;
            for (let poll = 0; poll < 30; poll++) {
              await page.waitForTimeout(1500);
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
                console.log(`[GoogleFlowService] ✨ Generated successfully in ${(poll + 1) * 1.5}s!`);
                break;
              }
            }

            if (!generatedImgSrc) {
              throw new Error('Google Flow generation timed out after 45s');
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
            console.log(`[GoogleFlowService] ✨ Remastered image saved (${response.data.length} bytes) to: ${destPath}`);
            resolve(destPath);
          } catch (err) {
            // If session had a crash, close and invalidate so next call creates a fresh session
            if (this.activeBrowser) {
              await this.activeBrowser.close().catch(() => {});
              this.activeBrowser = null;
              this.activePage = null;
            }
            reject(err);
          }
        })
        .catch(reject);
    });
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

