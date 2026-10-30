import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { chromium } from 'playwright';
import { StoryJob, JOB_STATUSES } from '../models/StoryJob.js';

const UPLOADS_DIR = path.resolve('uploads');
const RAW_DIR = path.join(UPLOADS_DIR, 'raw');

if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

/**
 * Facebook Photos Scraper Service
 * Uses Playwright to navigate to Facebook photos tab, extract fbid, verify uniqueness,
 * download raw photos and capture story text.
 */
export class PhotoScraper {
  constructor() {
    this.userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  /**
   * Scrapes photo posts from Facebook Page photos tab
   * @param {string} sourceUrl - Facebook Fanpage Photos URL (e.g. https://www.facebook.com/SomePage/photos)
   * @param {number} maxItems - Maximum photos to harvest (e.g. 70)
   * @returns {Promise<{ found: number, added: number, skipped: number, jobs: Array }>}
   */
  async scrapeFanpagePhotos(sourceUrl, maxItems = 70) {
    let normalizedUrl = sourceUrl.trim();
    if (!normalizedUrl.includes('photos') && !normalizedUrl.includes('sk=photos')) {
      normalizedUrl = normalizedUrl.endsWith('/')
        ? `${normalizedUrl}photos`
        : `${normalizedUrl}/photos`;
    }

    console.log(`[PhotoScraper] Starting scrape on: ${normalizedUrl} (Target: ${maxItems} items)...`);

    let browser;
    const results = {
      found: 0,
      added: 0,
      skipped: 0,
      jobs: []
    };

    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-notifications'
        ]
      });

      const context = await browser.newContext({
        userAgent: this.userAgent,
        viewport: { width: 1366, height: 900 },
        locale: 'en-US'
      });

      const page = await context.newPage();
      
      // Navigate to the target photo collection
      await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      // Dismiss cookie banners / popups if present
      await this._dismissPopups(page);

      // Extract page title or name
      const pageTitle = await page.title().catch(() => 'Facebook Source Page');

      // Scroll and harvest photo links
      const photoLinks = await this._collectPhotoLinks(page, maxItems);
      results.found = photoLinks.length;
      console.log(`[PhotoScraper] Discovered ${photoLinks.length} photo entries on source page.`);

      for (const item of photoLinks) {
        if (results.added >= maxItems) break;

        const { fbid, postUrl, previewImgUrl } = item;

        // 100% Anti-duplicate check in MongoDB
        const existing = await StoryJob.findOne({ fbid });
        if (existing) {
          console.log(`[PhotoScraper] [SKIP] FBID already in DB: ${fbid}`);
          results.skipped++;
          continue;
        }

        try {
          // Extract full photo details (high-res image + English story text)
          const details = await this._extractPhotoDetails(page, postUrl, previewImgUrl);

          // Save raw image file to disk
          const rawFileName = `raw_${fbid}.jpg`;
          const rawFilePath = path.join(RAW_DIR, rawFileName);

          await this._downloadImage(details.imageUrl, rawFilePath);

          // Create new StoryJob in MongoDB
          const newJob = await StoryJob.create({
            fbid,
            sourcePostUrl: postUrl,
            sourcePageName: pageTitle.replace(/ - Home \| Facebook| \| Facebook/gi, '').trim(),
            rawImageUrl: details.imageUrl,
            rawImagePath: rawFilePath,
            originalStoryEn: details.storyText || 'An emotional life story depicting human compassion and unexpected kindness.',
            status: JOB_STATUSES.PENDING,
            currentStep: 'Thu hoạch thành công (Pending Worker)'
          });

          results.added++;
          results.jobs.push(newJob);
          console.log(`[PhotoScraper] [ADDED] Job created for FBID: ${fbid} (${results.added}/${maxItems})`);
        } catch (itemErr) {
          console.error(`[PhotoScraper] Error processing photo ${fbid}: ${itemErr.message}`);
        }
      }

      console.log(`[PhotoScraper] Scrape summary: Found ${results.found}, Added ${results.added}, Skipped ${results.skipped}`);
      return results;
    } catch (err) {
      console.error(`[PhotoScraper] Scraper error: ${err.message}`);
      throw err;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  /**
   * Helper to dismiss Facebook consent dialogs & login overlays
   */
  async _dismissPopups(page) {
    try {
      const dismissSelectors = [
        'button[data-cookiebanner="accept_button"]',
        'button:has-text("Allow all cookies")',
        'button:has-text("Decline optional cookies")',
        'button:has-text("Alle Cookies erlauben")',
        'div[aria-label="Close"]',
        'div[aria-label="Đóng"]',
        'div[aria-label="Schließen"]',
        'div[role="dialog"] [aria-label="Close"]'
      ];

      for (const sel of dismissSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(500);
        }
      }
    } catch (e) {
      // Ignore dismiss error
    }
  }

  /**
   * Collect photo links and unique fbids from page DOM
   */
  async _collectPhotoLinks(page, maxItems) {
    const collected = new Map();
    let scrollAttempts = 0;
    const maxScrolls = 15;

    while (collected.size < maxItems && scrollAttempts < maxScrolls) {
      // Find all anchors referencing photos
      const links = await page.$$eval('a[href*="/photo"], a[href*="fbid="]', (elements) => {
        return elements.map((el) => {
          const href = el.href || '';
          const img = el.querySelector('img');
          const previewSrc = img ? img.src : '';
          return { href, previewSrc };
        });
      });

      for (const item of links) {
        const fbidMatch = item.href.match(/fbid=([0-9]+)/) || item.href.match(/\/photos\/a\.[0-9]+\/([0-9]+)/);
        if (fbidMatch && fbidMatch[1]) {
          const fbid = fbidMatch[1];
          if (!collected.has(fbid)) {
            collected.set(fbid, {
              fbid,
              postUrl: item.href,
              previewImgUrl: item.previewSrc
            });
          }
        }
      }

      // Scroll down to load more content
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(1500);
      scrollAttempts++;
    }

    return Array.from(collected.values());
  }

  /**
   * Extract high-res image and text from a photo page or preview
   */
  async _extractPhotoDetails(page, postUrl, fallbackImgUrl) {
    let imageUrl = fallbackImgUrl;
    let storyText = '';

    try {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(2000);
      await this._dismissPopups(page);

      // Locate full-size photo in viewer or dialog
      const highResImg = await page.$eval(
        'img[data-visualcompletion="media-vc-image"], img[data-visualcompletion="css-img"], img[src*="scontent"]',
        (img) => img.src
      ).catch(() => null);

      if (highResImg) {
        imageUrl = highResImg;
      }

      // Extract story text from right column or description
      const text = await page.$eval(
        'div[role="dialog"] div[dir="auto"], div[data-ad-preview="message"], div[data-ad-comet-preview="message"]',
        (div) => div.innerText
      ).catch(() => '');

      if (text && text.trim().length > 10) {
        storyText = text.trim();
      }
    } catch (e) {
      console.warn(`[PhotoScraper] In-depth photo parse warning: ${e.message}. Using preview.`);
    }

    return {
      imageUrl: imageUrl || fallbackImgUrl,
      storyText: storyText || 'A touching story about human kindness and family values.'
    };
  }

  /**
   * Download image to local file path
   */
  async _downloadImage(imageUrl, destPath) {
    if (!imageUrl || !imageUrl.startsWith('http')) {
      // Create a solid fallback image buffer if no valid image URL was fetched
      const blankSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
        <rect width="800" height="800" fill="#1e293b"/>
        <text x="400" y="400" fill="#f8fafc" font-size="28" font-family="sans-serif" text-anchor="middle">Story Comic Illustration</text>
      </svg>`;
      fs.writeFileSync(destPath, Buffer.from(blankSvg));
      return;
    }

    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': this.userAgent,
        Referer: 'https://www.facebook.com/'
      }
    });

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }
}

export const photoScraper = new PhotoScraper();
