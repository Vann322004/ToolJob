import express from 'express';
import fs from 'fs';
import path from 'path';
import { StoryJob, JOB_STATUSES } from '../models/StoryJob.js';
import { Fanpage } from '../models/Fanpage.js';
import { photoScraper } from '../services/photoScraper.js';
import { jobWorker } from '../workers/jobWorker.js';
import { googleFlowService } from '../services/googleFlowService.js';

const router = express.Router();
const UPLOADS_DIR = path.resolve('uploads');
const RAW_DIR = path.join(UPLOADS_DIR, 'raw');

/**
 * POST /api/scrape
 * Trigger Facebook Photos Scraper
 */
router.post('/scrape', async (req, res) => {
  try {
    const { sourceUrl, maxPhotos = 70 } = req.body;

    if (!sourceUrl || typeof sourceUrl !== 'string') {
      return res.status(400).json({ error: 'sourceUrl is required' });
    }

    // Launch scraper in background so HTTP response is returned immediately
    photoScraper
      .scrapeFanpagePhotos(sourceUrl, parseInt(maxPhotos, 10) || 70)
      .then((report) => {
        console.log(`[JobRoutes] Scrape completed: +${report.added} new jobs queued.`);
      })
      .catch((err) => {
        console.error('[JobRoutes] Background scrape error:', err.message);
      });

    res.json({
      success: true,
      message: `Đã kích hoạt cào ảnh từ ${sourceUrl}. Tiến trình đang chạy ngầm...`,
      sourceUrl,
      targetPhotos: maxPhotos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats
 * Dashboard Statistics & Progress towards 70 posts/day
 */
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    const [
      totalJobs,
      pendingCount,
      remasteringCount,
      translatingCount,
      schedulingCount,
      scheduledCount,
      failedCount,
      scheduledToday,
      fanpages
    ] = await Promise.all([
      StoryJob.countDocuments(),
      StoryJob.countDocuments({ status: JOB_STATUSES.PENDING }),
      StoryJob.countDocuments({ status: JOB_STATUSES.REMASTERING }),
      StoryJob.countDocuments({ status: JOB_STATUSES.TRANSLATING }),
      StoryJob.countDocuments({ status: JOB_STATUSES.SCHEDULING }),
      StoryJob.countDocuments({ status: JOB_STATUSES.SCHEDULED }),
      StoryJob.countDocuments({ status: JOB_STATUSES.FAILED }),
      StoryJob.countDocuments({
        status: JOB_STATUSES.SCHEDULED,
        scheduledPublishTime: { $gte: startOfDay }
      }),
      Fanpage.find({ isActive: true }).lean()
    ]);

    const targetDailyTotal = fanpages.reduce((acc, p) => acc + (p.dailyTarget || 7), 0) || 70;
    const progressPercent = Math.min(100, Math.round((scheduledToday / targetDailyTotal) * 100));

    res.json({
      success: true,
      stats: {
        totalJobs,
        pending: pendingCount,
        inProgress: remasteringCount + translatingCount + schedulingCount,
        scheduled: scheduledCount,
        failed: failedCount,
        scheduledToday,
        targetDailyTotal,
        progressPercent,
        activePagesCount: fanpages.length
      },
      worker: {
        isActive: jobWorker.isActive,
        isProcessing: jobWorker.isProcessing,
        stats: jobWorker.stats
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/jobs
 * List StoryJobs with pagination and status filters
 */
router.get('/jobs', async (req, res) => {
  try {
    const { status, limit = 50, page = 1, search } = req.query;
    const query = {};

    if (status && status !== 'ALL') {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { fbid: { $regex: search, $options: 'i' } },
        { germanTitle: { $regex: search, $options: 'i' } },
        { targetFanpageName: { $regex: search, $options: 'i' } }
      ];
    }

    const parsedLimit = Math.min(100, parseInt(limit, 10) || 50);
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [jobs, total] = await Promise.all([
      StoryJob.find(query).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
      StoryJob.countDocuments(query)
    ]);

    res.json({
      success: true,
      jobs,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/jobs/:id/retry
 * Retry a failed or pending job
 */
router.post('/jobs/:id/retry', async (req, res) => {
  try {
    const job = await StoryJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    job.status = JOB_STATUSES.PENDING;
    job.currentStep = 'Đã đặt lại hàng chờ (Retried by user)';
    job.errorLog = '';
    await job.save();

    res.json({ success: true, message: 'Job has been reset to PENDING', job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/jobs/:id/import-flow
 * Import a Google Flow generated image URL directly into the job
 */
router.post('/jobs/:id/import-flow', async (req, res) => {
  try {
    const { flowUrl } = req.body;
    if (!flowUrl) return res.status(400).json({ error: 'flowUrl is required' });

    const job = await StoryJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Extract direct flow image URL
    const directImageUrl = await googleFlowService.resolveSharedImageUrl(flowUrl);
    if (!directImageUrl) {
      return res.status(400).json({ error: 'Could not extract image from Google Flow URL' });
    }

    const remasteredDir = path.resolve('uploads', 'remastered');
    if (!fs.existsSync(remasteredDir)) fs.mkdirSync(remasteredDir, { recursive: true });

    const destPath = path.join(remasteredDir, `remastered_${job.fbid}.jpg`);
    await googleFlowService.downloadImage(directImageUrl, destPath);

    job.remasteredImagePath = destPath;
    job.currentStep = 'Đã cập nhật ảnh siêu nét từ Google Flow (Nano Banana 2.1)';
    await job.save();

    res.json({
      success: true,
      message: 'Đã cập nhật ảnh thành công từ Google Flow!',
      job
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/jobs/:id
 */
router.delete('/jobs/:id', async (req, res) => {
  try {
    const job = await StoryJob.findByIdAndDelete(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json({ success: true, message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

