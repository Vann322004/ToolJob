import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import jobRoutes from './routes/jobRoutes.js';
import { Fanpage } from './models/Fanpage.js';
import { StoryJob, JOB_STATUSES } from './models/StoryJob.js';
import { jobWorker } from './workers/jobWorker.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fb_german_automation';

// Ensure uploads directories exist
const uploadsDir = path.resolve('uploads');
const rawDir = path.join(uploadsDir, 'raw');
const remasteredDir = path.join(uploadsDir, 'remastered');

[uploadsDir, rawDir, remasteredDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file serving for raw and remastered images
app.use('/uploads', express.static(uploadsDir));

// API Routes
app.use('/api', jobRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    dbState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    workerActive: jobWorker.isActive,
    timestamp: new Date().toISOString()
  });
});

// Serve frontend static files
const frontendDir = path.resolve('frontend', 'dist');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
} else {
  // Fallback to standalone frontend template
  const publicDir = path.resolve('frontend', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }
}

let inMemoryServer = null;

// Connect to MongoDB with automatic fallback to Embedded In-Memory Database
async function connectDatabase() {
  try {
    console.log(`[Database] Connecting to MongoDB at ${MONGODB_URI}...`);
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 3000
    });
    console.log('[Database] MongoDB connection established successfully.');
  } catch (err) {
    console.warn(`[Database] Local/Configured MongoDB is offline (${err.message}).`);
    console.log('[Database] ⚡ Activating Embedded In-Memory MongoDB Server (zero setup)...');
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      inMemoryServer = await MongoMemoryServer.create({
        instance: {
          dbName: 'fb_german_automation'
        }
      });
      const memoryUri = inMemoryServer.getUri();
      console.log(`[Database] 🚀 Embedded MongoDB ready at: ${memoryUri}`);
      await mongoose.connect(memoryUri);
      console.log('[Database] Connected to Embedded In-Memory Database successfully!');
    } catch (memErr) {
      console.error(`[Database Fatal Error] Failed to start embedded database: ${memErr.message}`);
      throw memErr;
    }
  }
}

// Bootstrap application
async function bootstrap() {
  try {
    await connectDatabase();

    // Seed 10 German Fanpages if not yet seeded
    await Fanpage.seedDefaultPages();

    // Auto-restore existing jobs from disk if DB is clean
    const existingJobsCount = await StoryJob.countDocuments();
    if (existingJobsCount === 0 && fs.existsSync(rawDir)) {
      const files = fs.readdirSync(rawDir).filter((f) => f.startsWith('raw_') && f.endsWith('.jpg'));
      console.log(`[Database] Auto-restoring ${files.length} existing jobs from disk...`);
      for (const file of files) {
        const fbid = file.replace('raw_', '').replace('.jpg', '');
        const rawFilePath = path.join(rawDir, file);
        const remPath = path.join(remasteredDir, `remastered_${fbid}.jpg`);
        const hasRemastered = fs.existsSync(remPath);
        await StoryJob.create({
          fbid,
          sourcePostUrl: `https://www.facebook.com/photo.php?fbid=${fbid}`,
          sourcePageName: 'Life Stories & Heartwarming Comics',
          rawImageUrl: `/uploads/raw/${file}`,
          rawImagePath: rawFilePath,
          remasteredImagePath: hasRemastered ? remPath : null,
          status: hasRemastered ? JOB_STATUSES.SCHEDULED : JOB_STATUSES.PENDING,
          currentStep: hasRemastered ? 'Đã hoàn tất lên lịch' : 'Chờ xử lý',
          germanTitle: 'Eine berührende Schicksalsgeschichte, die zu Herzen geht',
          germanCaption: 'Manchmal hält das Leben Prüfungen bereit, die uns zeigen, wer wir wirklich sind... #Leben #Hoffnung'
        }).catch(() => {});
      }
      console.log(`[Database] Successfully restored existing jobs to DB.`);
    }

    // Start background worker for pending jobs
    jobWorker.startWorker();

    app.listen(PORT, () => {
      console.log('====================================================');
      console.log(`🚀 FB German Automation Server running on port ${PORT}`);
      console.log(`🌐 Dashboard: http://localhost:${PORT}`);
      console.log(`📡 API Base:   http://localhost:${PORT}/api`);
      console.log(`⚙️  Target:     10 Fanpages x 7 Slots = 70 Posts/Day`);
      console.log('====================================================');
    });
  } catch (err) {
    console.error(`[Server Error] Failed to start application: ${err.message}`);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down gracefully...');
  jobWorker.stopWorker();
  await mongoose.disconnect();
  if (inMemoryServer) {
    await inMemoryServer.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  jobWorker.stopWorker();
  await mongoose.disconnect();
  if (inMemoryServer) {
    await inMemoryServer.stop();
  }
  process.exit(0);
});

bootstrap();
