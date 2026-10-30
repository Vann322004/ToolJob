import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { StoryJob } from '../models/StoryJob.js';

/**
 * Meta Business Suite / Facebook Graph API Publisher
 * Schedules posts with photos and German captions to target Fanpages
 */
export class MetaPublisher {
  constructor() {
    this.apiVersion = process.env.META_GRAPH_API_VERSION || 'v19.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
    this.simulatePublish = process.env.SIMULATE_META_PUBLISH !== 'false';
  }

  /**
   * Calculate the next available schedule slot for a given Fanpage
   * Ensures no 2 posts share the exact same slot on the same page
   * @param {Object} fanpage - Fanpage model document
   * @returns {Promise<Date>} - Next available schedule Date object
   */
  async getNextAvailableSlot(fanpage) {
    const slots = fanpage.scheduleSlots && fanpage.scheduleSlots.length > 0
      ? fanpage.scheduleSlots
      : ['08:00', '10:30', '13:00', '15:30', '18:00', '20:30', '22:00'];

    const now = new Date();
    // Meta requires scheduled_publish_time to be at least 10 minutes in the future
    const minPublishTime = new Date(now.getTime() + 15 * 60 * 1000);

    // Look ahead up to 14 days to find the earliest free slot
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const targetDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getDate()).padStart(2, '0');
      const datePrefix = `${year}-${month}-${day}`;

      for (const slotTime of slots) {
        const [hours, minutes] = slotTime.split(':').map(Number);
        // Build candidate timestamp (local Berlin equivalent)
        const candidateSlot = new Date(year, targetDate.getMonth(), targetDate.getDate(), hours, minutes, 0, 0);

        // Slot must be at least 15 minutes ahead of current time
        if (candidateSlot <= minPublishTime) {
          continue;
        }

        // Check if a job is already scheduled for this page at this time (+/- 5 minutes)
        const startWindow = new Date(candidateSlot.getTime() - 5 * 60 * 1000);
        const endWindow = new Date(candidateSlot.getTime() + 5 * 60 * 1000);

        const existingJob = await StoryJob.findOne({
          targetFanpageId: fanpage.pageId,
          scheduledPublishTime: { $gte: startWindow, $lte: endWindow },
          status: { $in: ['SCHEDULING', 'SCHEDULED'] }
        });

        if (!existingJob) {
          return candidateSlot;
        }
      }
    }

    // Default fallback: 1 hour in the future
    return new Date(now.getTime() + 60 * 60 * 1000);
  }

  /**
   * Schedule photo post to Meta Business Suite / Facebook Graph API
   * @param {Object} job - StoryJob document
   * @param {Object} fanpage - Fanpage document
   * @param {Date} scheduledTime - Chosen Date to publish
   * @returns {Promise<{ success: boolean, metaPostId: string, scheduledTime: Date }>}
   */
  async schedulePost(job, fanpage, scheduledTime) {
    const { remasteredImagePath, rawImagePath, germanCaption, germanTitle, fbid } = job;
    const imageToUpload = remasteredImagePath && fs.existsSync(remasteredImagePath)
      ? remasteredImagePath
      : rawImagePath;

    if (!fs.existsSync(imageToUpload)) {
      throw new Error(`Image file not found for scheduling: ${imageToUpload}`);
    }

    const scheduledTimestampUnix = Math.floor(scheduledTime.getTime() / 1000);
    const caption = germanCaption || germanTitle || 'Eine berührende Geschichte.';

    console.log(`[MetaPublisher] Scheduling post for FBID: ${fbid} -> Page: ${fanpage.name} (${fanpage.pageId}) at ${scheduledTime.toISOString()}`);

    // If simulation mode or mock token, return mock response
    const isMockToken = !fanpage.accessToken || fanpage.accessToken.startsWith('EAAB_MOCK') || fanpage.accessToken.length < 20;
    if (this.simulatePublish && isMockToken) {
      console.log(`[MetaPublisher] [SIMULATION] Scheduled post successfully simulated.`);
      const mockPostId = `meta_${fanpage.pageId}_${Date.now()}`;
      return {
        success: true,
        metaPostId: mockPostId,
        scheduledTime
      };
    }

    // Real Meta Graph API Call
    try {
      const url = `${this.baseUrl}/${fanpage.pageId}/photos`;
      const form = new FormData();
      form.append('source', fs.createReadStream(imageToUpload));
      form.append('caption', caption);
      form.append('published', 'false');
      form.append('scheduled_publish_time', String(scheduledTimestampUnix));
      form.append('access_token', fanpage.accessToken);

      const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 60000
      });

      const metaPostId = response.data?.id || response.data?.post_id || `fb_${Date.now()}`;
      console.log(`[MetaPublisher] Real Meta post scheduled! Post ID: ${metaPostId}`);

      return {
        success: true,
        metaPostId,
        scheduledTime
      };
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || err.message;
      console.error(`[MetaPublisher] Failed to schedule post on Facebook Graph API: ${errorMsg}`);
      throw new Error(`Meta Graph API Error: ${errorMsg}`);
    }
  }
}

export const metaPublisher = new MetaPublisher();
