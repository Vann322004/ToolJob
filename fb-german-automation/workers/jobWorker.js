import { StoryJob, JOB_STATUSES } from '../models/StoryJob.js';
import { Fanpage } from '../models/Fanpage.js';
import { nanoBananaService } from '../services/nanoBananaService.js';
import { germanTranslator } from '../services/germanTranslator.js';
import { metaPublisher } from '../services/metaPublisher.js';

export class JobWorker {
  constructor() {
    this.intervalMs = parseInt(process.env.WORKER_INTERVAL_MS || '7000', 10);
    this.timer = null;
    this.isProcessing = false;
    this.isActive = true;
    this.stats = {
      cyclesCompleted: 0,
      jobsProcessed: 0,
      lastRunAt: null,
      lastError: null
    };
  }

  /**
   * Start the recurring background worker
   */
  startWorker() {
    if (this.timer) {
      console.log('[JobWorker] Worker is already running.');
      return;
    }

    console.log(`[JobWorker] Background worker started. Polling interval: ${this.intervalMs}ms`);
    this.isActive = true;

    // Run first cycle immediately
    this._processNextCycle().catch((err) => console.error('[JobWorker] Initial cycle error:', err));

    // Schedule regular cycles
    this.timer = setInterval(() => {
      if (this.isActive) {
        this._processNextCycle().catch((err) => console.error('[JobWorker] Cycle tick error:', err));
      }
    }, this.intervalMs);
  }

  /**
   * Stop the background worker
   */
  stopWorker() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isActive = false;
    console.log('[JobWorker] Background worker paused.');
  }

  /**
   * Toggle worker active state
   */
  toggle() {
    if (this.isActive && this.timer) {
      this.stopWorker();
      return false;
    } else {
      this.startWorker();
      return true;
    }
  }

  /**
   * Single processing cycle
   */
  async _processNextCycle() {
    if (this.isProcessing) {
      return; // Skip cycle if previous is still busy
    }

    this.isProcessing = true;
    this.stats.lastRunAt = new Date();

    try {
      // Find the next pending job (FIFO order)
      const job = await StoryJob.findOne({
        status: { $in: [JOB_STATUSES.PENDING] }
      }).sort({ createdAt: 1 });

      if (!job) {
        this.isProcessing = false;
        return;
      }

      console.log(`[JobWorker] Found PENDING job for processing: FBID ${job.fbid}`);
      await this.processJob(job);
      this.stats.jobsProcessed++;
      this.stats.cyclesCompleted++;
    } catch (err) {
      console.error(`[JobWorker] Error in cycle: ${err.message}`);
      this.stats.lastError = err.message;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Execute the 3-step automation pipeline for a StoryJob:
   * 1. Remaster image with AI (Nano Banana / Gemini)
   * 2. Translate and localize story to German
   * 3. Schedule post into Meta Business Suite for target fanpage
   */
  async processJob(job) {
    const startTime = Date.now();
    try {
      // Step 1: Update to REMASTERNG
      job.status = JOB_STATUSES.REMASTERING;
      job.currentStep = 'Đang sửa ảnh AI (Nano Banana / Gemini 2.5)...';
      await job.save();

      const remasteredPath = await nanoBananaService.remasterImage(job);
      job.remasteredImagePath = remasteredPath;
      job.currentStep = 'Sửa ảnh AI hoàn tất. Đang dịch sang tiếng Đức...';
      await job.save();

      // Step 2: Translate and rewrite story to German
      job.status = JOB_STATUSES.TRANSLATING;
      await job.save();

      const germanResult = await germanTranslator.translateToGerman(job.originalStoryEn);
      job.germanTitle = germanResult.germanTitle;
      job.germanStory = germanResult.germanStory;
      job.germanCaption = germanResult.fullCaption;
      job.currentStep = 'Dịch tiếng Đức hoàn tất. Đang chọn Fanpage và lên lịch Meta...';
      await job.save();

      // Step 3: Select target Fanpage and find next schedule slot
      job.status = JOB_STATUSES.SCHEDULING;
      await job.save();

      const targetFanpage = await this._selectNextTargetFanpage();
      if (!targetFanpage) {
        throw new Error('No active Fanpages found in database to schedule post.');
      }

      const scheduledSlot = await metaPublisher.getNextAvailableSlot(targetFanpage);
      const publishResult = await metaPublisher.schedulePost(job, targetFanpage, scheduledSlot);

      // Final step: Mark SCHEDULED
      job.targetFanpageId = targetFanpage.pageId;
      job.targetFanpageName = targetFanpage.name;
      job.scheduledPublishTime = publishResult.scheduledTime;
      job.metaPostId = publishResult.metaPostId;
      job.status = JOB_STATUSES.SCHEDULED;
      job.currentStep = `Đã lên lịch Meta Business Suite (${targetFanpage.name} lúc ${scheduledSlot.toLocaleString('de-DE')})`;
      job.processedAt = new Date();
      job.errorLog = '';
      await job.save();

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[JobWorker] Job FBID: ${job.fbid} successfully completed in ${durationSec}s!`);
    } catch (err) {
      console.error(`[JobWorker] Failed processing job FBID: ${job.fbid}: ${err.message}`);
      job.status = JOB_STATUSES.FAILED;
      job.currentStep = `Lỗi xử lý: ${err.message}`;
      job.errorLog = `${new Date().toISOString()} - ${err.message}\n${err.stack || ''}`;
      job.retryCount = (job.retryCount || 0) + 1;
      await job.save();
    }
  }

  /**
   * Distribute posts evenly across active Fanpages (Round Robin / Least loaded)
   */
  async _selectNextTargetFanpage() {
    const activePages = await Fanpage.find({ isActive: true });
    if (!activePages || activePages.length === 0) return null;

    // Count scheduled jobs per page for the upcoming 24 hours
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const counts = await Promise.all(
      activePages.map(async (page) => {
        const scheduledCount = await StoryJob.countDocuments({
          targetFanpageId: page.pageId,
          scheduledPublishTime: { $gte: now, $lte: next24h }
        });
        return { page, scheduledCount };
      })
    );

    // Pick page with the lowest scheduled count below daily target
    counts.sort((a, b) => a.scheduledCount - b.scheduledCount);
    return counts[0]?.page || activePages[0];
  }
}

export const jobWorker = new JobWorker();
