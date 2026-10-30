import mongoose from 'mongoose';

export const JOB_STATUSES = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  REMASTERING: 'REMASTERING',
  TRANSLATING: 'TRANSLATING',
  SCHEDULING: 'SCHEDULING',
  SCHEDULED: 'SCHEDULED',
  FAILED: 'FAILED'
};

const storyJobSchema = new mongoose.Schema(
  {
    fbid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    sourcePostUrl: {
      type: String,
      required: true,
      trim: true
    },
    sourcePageName: {
      type: String,
      default: '',
      trim: true
    },
    rawImageUrl: {
      type: String,
      default: '',
      trim: true
    },
    rawImagePath: {
      type: String,
      required: true,
      trim: true
    },
    remasteredImagePath: {
      type: String,
      default: '',
      trim: true
    },
    originalStoryEn: {
      type: String,
      default: '',
      trim: true
    },
    germanTitle: {
      type: String,
      default: '',
      trim: true
    },
    germanStory: {
      type: String,
      default: '',
      trim: true
    },
    germanCaption: {
      type: String,
      default: '',
      trim: true
    },
    targetFanpageId: {
      type: String,
      default: '',
      index: true
    },
    targetFanpageName: {
      type: String,
      default: ''
    },
    scheduledPublishTime: {
      type: Date,
      default: null,
      index: true
    },
    metaPostId: {
      type: String,
      default: '',
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(JOB_STATUSES),
      default: JOB_STATUSES.PENDING,
      index: true
    },
    currentStep: {
      type: String,
      default: 'Chờ xử lý (Pending)'
    },
    errorLog: {
      type: String,
      default: ''
    },
    retryCount: {
      type: Number,
      default: 0
    },
    processedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Composite indexes for fast query in worker and dashboard
storyJobSchema.index({ status: 1, createdAt: 1 });
storyJobSchema.index({ targetFanpageId: 1, scheduledPublishTime: 1 });

export const StoryJob = mongoose.model('StoryJob', storyJobSchema);
