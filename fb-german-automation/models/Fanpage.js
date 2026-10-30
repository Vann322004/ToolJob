import mongoose from 'mongoose';

const DEFAULT_SCHEDULE_SLOTS = [
  '08:00',
  '10:30',
  '13:00',
  '15:30',
  '18:00',
  '20:30',
  '22:00'
];

const fanpageSchema = new mongoose.Schema(
  {
    pageId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    accessToken: {
      type: String,
      default: '',
      trim: true
    },
    scheduleSlots: {
      type: [String],
      default: DEFAULT_SCHEDULE_SLOTS,
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'A fanpage must have at least one schedule slot'
      }
    },
    dailyTarget: {
      type: Number,
      default: 7
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    timezone: {
      type: String,
      default: 'Europe/Berlin'
    },
    category: {
      type: String,
      default: 'Story / Comic / Life Lessons'
    },
    notes: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

/**
 * Seed 10 default German Fanpages if collection is empty
 */
fanpageSchema.statics.seedDefaultPages = async function () {
  const count = await this.countDocuments();
  if (count > 0) return false;

  const defaultPages = [
    { pageId: 'PAGE_DE_01', name: 'Wahre Geschichten Deutschland', accessToken: 'EAAB_MOCK_TOKEN_PAGE_1' },
    { pageId: 'PAGE_DE_02', name: 'Lebensweisheiten & Schicksale', accessToken: 'EAAB_MOCK_TOKEN_PAGE_2' },
    { pageId: 'PAGE_DE_03', name: 'Herz & Verstand Geschichten', accessToken: 'EAAB_MOCK_TOKEN_PAGE_3' },
    { pageId: 'PAGE_DE_04', name: 'Deutsche Comic & Story Welt', accessToken: 'EAAB_MOCK_TOKEN_PAGE_4' },
    { pageId: 'PAGE_DE_05', name: 'Tiefsinnige Momente DE', accessToken: 'EAAB_MOCK_TOKEN_PAGE_5' },
    { pageId: 'PAGE_DE_06', name: 'Geschichten Die Das Leben Schreibt', accessToken: 'EAAB_MOCK_TOKEN_PAGE_6' },
    { pageId: 'PAGE_DE_07', name: 'Emotionale Reisen Deutschland', accessToken: 'EAAB_MOCK_TOKEN_PAGE_7' },
    { pageId: 'PAGE_DE_08', name: 'Hoffnung & Inspiration Daily', accessToken: 'EAAB_MOCK_TOKEN_PAGE_8' },
    { pageId: 'PAGE_DE_09', name: 'Blickwinkel: Das Leben Verstehen', accessToken: 'EAAB_MOCK_TOKEN_PAGE_9' },
    { pageId: 'PAGE_DE_10', name: 'Wunder des Alltags DE', accessToken: 'EAAB_MOCK_TOKEN_PAGE_10' }
  ].map((p) => ({
    ...p,
    scheduleSlots: DEFAULT_SCHEDULE_SLOTS,
    dailyTarget: 7,
    isActive: true,
    timezone: 'Europe/Berlin'
  }));

  await this.insertMany(defaultPages);
  console.log(`[Database] Successfully seeded 10 default Fanpages with 7 schedule slots/day each.`);
  return true;
};

export const Fanpage = mongoose.model('Fanpage', fanpageSchema);
export { DEFAULT_SCHEDULE_SLOTS };
