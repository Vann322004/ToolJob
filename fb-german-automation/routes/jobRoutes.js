import express from 'express';
import fs from 'fs';
import path from 'path';
import { StoryJob, JOB_STATUSES } from '../models/StoryJob.js';
import { Fanpage } from '../models/Fanpage.js';
import { photoScraper } from '../services/photoScraper.js';
import { jobWorker } from '../workers/jobWorker.js';
import { googleFlowService } from '../services/googleFlowService.js';
import { nanoBananaService } from '../services/nanoBananaService.js';

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
 * POST /api/jobs/:id/auto-flow
 * Automatically launch Google Flow headless, generate Nano Banana 2.1 image and save
 */
router.post('/jobs/:id/auto-flow', async (req, res) => {
  try {
    const job = await StoryJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const remasteredDir = path.resolve('uploads', 'remastered');
    if (!fs.existsSync(remasteredDir)) fs.mkdirSync(remasteredDir, { recursive: true });
    const destPath = path.join(remasteredDir, `remastered_${job.fbid}.jpg`);

    console.log(`[JobRoutes] Generating vision prompt for job ${job.fbid}...`);
    const flowPrompt = await nanoBananaService._generateVisionPrompt(job.rawImagePath, job.originalStoryEn);
    console.log(`[JobRoutes] Flow Prompt generated: ${flowPrompt.slice(0, 100)}...`);

    await googleFlowService.generateImageWithFlow(flowPrompt, destPath);

    job.remasteredImagePath = destPath;
    job.currentStep = 'Đã tự động tạo ảnh siêu nét từ Google Flow PRO (Nano Banana 2.1)';
    await job.save();

    res.json({
      success: true,
      message: 'Đã tự động tạo và cập nhật ảnh thành công từ Google Flow PRO!',
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

/**
 * GET /api/fanpages
 * Get 10 Fanpages and their scheduled load
 */
router.get('/fanpages', async (req, res) => {
  try {
    const fanpages = await Fanpage.find().sort({ pageId: 1 }).lean();
    
    const pagesWithLoad = await Promise.all(
      fanpages.map(async (page) => {
        const scheduledCount = await StoryJob.countDocuments({
          targetFanpageId: page.pageId,
          status: JOB_STATUSES.SCHEDULED
        });
        return {
          ...page,
          scheduledCount
        };
      })
    );

    res.json({ success: true, fanpages: pagesWithLoad });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/fanpages/seed
 * Seed / reset 10 German Fanpages with 7 slots/day
 */
router.post('/fanpages/seed', async (req, res) => {
  try {
    await Fanpage.seedDefaultPages();
    const fanpages = await Fanpage.find().lean();
    res.json({ success: true, message: '10 Fanpages verified / seeded', fanpages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/fanpages/:id
 * Update Fanpage configuration (AccessToken, scheduleSlots, etc.)
 */
router.put('/fanpages/:id', async (req, res) => {
  try {
    const { name, accessToken, scheduleSlots, dailyTarget, isActive } = req.body;
    const page = await Fanpage.findByIdAndUpdate(
      req.params.id,
      {
        ...(name && { name }),
        ...(accessToken !== undefined && { accessToken }),
        ...(scheduleSlots && { scheduleSlots }),
        ...(dailyTarget !== undefined && { dailyTarget }),
        ...(isActive !== undefined && { isActive })
      },
      { new: true }
    );

    if (!page) return res.status(404).json({ error: 'Fanpage not found' });
    res.json({ success: true, fanpage: page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/worker/toggle
 * Toggle background worker
 */
router.post('/worker/toggle', (req, res) => {
  const isRunning = jobWorker.toggle();
  res.json({ success: true, isRunning, message: isRunning ? 'Worker resumed' : 'Worker paused' });
});

/**
 * POST /api/simulate-sample
 * Generate realistic test sample jobs to test pipeline immediately
 */
router.post('/simulate-sample', async (req, res) => {
  try {
    const count = Math.min(10, parseInt(req.body.count, 10) || 3);
    const createdJobs = [];

    const sampleStories = [
      'A blind old man dropped his groceries in the rain. Everyone walked past ignoring him, except a young boy who was rushing to a job interview. The boy stopped, gathered every item, and offered his umbrella. When the boy finally arrived at his interview soaked in water, the interviewer was the old man.',
      'An elderly baker gave away free warm bread every evening to homeless children. Thirty years later when his bakery caught fire and destroyed everything, hundreds of citizens gathered to rebuild it with their own hands—they were the children he once fed.',
      'A doctor saved a poor boy who had no money for surgery. 25 years later, the doctor fell critically ill and could not afford the treatment. When he woke up, the bill had a note: "Paid in full with a glass of warm milk 25 years ago."',
      'A retired soldier noticed a stray dog guarding an abandoned child in an alley. He took them both home, gave them shelter, and raised the child as his own son. Years later, that child grew up to become a decorated rescue officer.',
      'A poor mother skipped her meals for years so her daughter could afford art supplies. On graduation day, the daughter unveiled her masterpiece: a breathtaking portrait of her mother with the title "My Greatest Masterpiece".'
    ];

    for (let i = 0; i < count; i++) {
      const fbid = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
      const rawFileName = `raw_${fbid}.jpg`;
      const rawFilePath = path.join(RAW_DIR, rawFileName);

      // Create a clean sample illustration SVG/JPEG
      const colors = ['#1e3a8a', '#14532d', '#701a75', '#7c2d12', '#0f766e'];
      const bg = colors[i % colors.length];
      const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
        <defs>
          <linearGradient id="grad${i}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${bg};stop-opacity:1" />
            <stop offset="100%" style="stop-color:#020617;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="900" height="900" fill="url(#grad${i})" />
        <circle cx="450" cy="380" r="160" fill="#f8fafc" opacity="0.15" />
        <circle cx="450" cy="340" r="70" fill="#38bdf8" />
        <rect x="370" y="430" width="160" height="180" rx="30" fill="#0284c7" />
        <text x="450" y="700" fill="#f8fafc" font-size="28" font-family="Segoe UI, sans-serif" font-weight="bold" text-anchor="middle">FB COMIC STORY #${fbid.slice(-4)}</text>
        <text x="450" y="745" fill="#94a3b8" font-size="20" font-family="Segoe UI, sans-serif" text-anchor="middle">Heartwarming Life Episode</text>
      </svg>`;

      fs.writeFileSync(rawFilePath, Buffer.from(sampleSvg));

      const job = await StoryJob.create({
        fbid,
        sourcePostUrl: `https://www.facebook.com/sample_page/photos/${fbid}`,
        sourcePageName: 'Life Lessons & Heartwarming Comics',
        rawImageUrl: `/uploads/raw/${rawFileName}`,
        rawImagePath: rawFilePath,
        originalStoryEn: sampleStories[i % sampleStories.length],
        status: JOB_STATUSES.PENDING,
        currentStep: 'Chờ xử lý (Pending Worker)'
      });

      createdJobs.push(job);
    }

    res.json({
      success: true,
      message: `Đã tạo ${createdJobs.length} Job mẫu. Worker sẽ tự động nhặt và xử lý trong 5-10 giây!`,
      jobs: createdJobs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

