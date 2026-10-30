# FB German Automation - Meta Business Suite 70 Posts/Day

Hệ thống tự động hóa Full-stack hoàn chỉnh:
- **Playwright**: Cào ảnh từ tab Photos của Fanpage nguồn Facebook (chống trùng lặp 100% qua MongoDB).
- **AI Remaster (Gemini 2.5 Flash Image / Nano Banana)**: Tự động xóa phụ đề tiếng Anh, watermark và nâng cấp độ phân giải ảnh comic/story.
- **Gemini Storyteller (gemini-2.5-flash)**: Dịch và phóng tác cốt truyện sang tiếng Đức với văn phong lôi cuốn, hook thu hút, CTA và bộ hashtag viral.
- **Meta Business Suite Publisher**: Tự động phân bổ lịch hẹn đăng bài (`scheduled_publish_time`) cho **10 Fanpage x 7 khung giờ vàng = 70 bài/ngày** tại Đức (08:00, 10:30, 13:00, 15:30, 18:00, 20:30, 22:00).
- **Background Worker**: Quét hàng đợi MongoDB liên tục mỗi 5-10s theo chuẩn quy trình 1-1.
- **React Real-time Dashboard**: Theo dõi tiến độ thời gian thực (Polling 3s), bảng quản lý 10 Fanpage, xem trước ảnh gốc / ảnh sửa AI và toàn văn caption tiếng Đức.

---

## 📁 Cấu Trúc Thư Mục

```
fb-german-automation/
├── models/
│   ├── Fanpage.js          # Model 10 Fanpage Đức (7 khung giờ/ngày, Page Access Token)
│   └── StoryJob.js         # Model quản lý Job (chống trùng fbid, trạng thái pipeline)
├── services/
│   ├── photoScraper.js     # Playwright cào tab Photos, tải ảnh thô và trích xuất cốt truyện
│   ├── nanoBananaService.js# AI sửa ảnh, xóa text tiếng Anh, nâng cấp chi tiết
│   ├── germanTranslator.js # Gemini dịch thuật & sáng tạo nội dung tiếng Đức
│   └── metaPublisher.js    # Lên lịch hẹn chuẩn Meta Graph API
├── workers/
│   └── jobWorker.js        # Worker chạy ngầm liên tục nhặt PENDING jobs
├── routes/
│   └── jobRoutes.js        # API endpoints (Scrape, Stats, Jobs, Fanpages, Sample Demo)
├── uploads/
│   ├── raw/                # Ảnh gốc tải về
│   └── remastered/         # Ảnh sau khi AI sửa/remaster
├── frontend/
│   └── public/
│       └── index.html      # React 18 + TailwindCSS Real-time Dashboard
├── .env.example
├── .env
├── package.json
└── server.js               # Express Server & khởi chạy background worker
```

---

## ⚙️ Cấu Hình Môi Trường (.env)

Mở file `.env` và điền các khóa API:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/fb_german_automation

# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

# Meta Business Suite / Graph API
META_GRAPH_API_VERSION=v19.0
SIMULATE_META_PUBLISH=true   # Đặt true để test giả lập khi chưa có Page Token thật

# Automation settings
WORKER_INTERVAL_MS=7000
DAILY_POSTS_PER_PAGE=7
DEFAULT_TIMEZONE=Europe/Berlin
```

---

## 🚀 Hướng Dẫn Khởi Chạy

1. Khởi động MongoDB (nếu dùng local):
   ```bash
   mongod
   ```
   *(Hoặc đổi `MONGODB_URI` trong `.env` sang MongoDB Atlas)*

2. Khởi chạy Server và Worker:
   ```bash
   cd fb-german-automation
   npm start
   ```

3. Mở Dashboard trên trình duyệt:
   **http://localhost:5000**

---

## 💡 Hướng Dẫn Sử Dụng Dashboard

1. **Thu hoạch tự động**:
   - Dán URL Facebook Photos nguồn vào ô nhập: Ví dụ `https://www.facebook.com/SomePage/photos`
   - Bấm nút **"🚀 Bắt đầu thu hoạch"**.
   - Playwright sẽ mở ngầm trình duyệt, duyệt tab Photos, đối chiếu `fbid` với MongoDB (bỏ qua những bài đã có 100%), tải ảnh vào `uploads/raw/` và trích xuất câu chuyện tiếng Anh.

2. **Chạy thử nghiệm ngay lập tức**:
   - Trên thanh điều hướng, bấm nút **"✨ Tạo 3 Job Test Mẫu"**.
   - Hệ thống sẽ sinh sẵn 3 bài mẫu truyện tranh cảm động, Worker ngầm sẽ tự động nhặt -> Sửa ảnh -> Dịch tiếng Đức -> Lên lịch Meta trong vòng 10-15 giây.

3. **Theo dõi tiến độ thời gian thực**:
   - Dashboard tự động cập nhật mỗi 3 giây.
   - Bấm nút **"Chi tiết"** ở từng dòng để xem so sánh trực quan giữa **Ảnh Gốc** và **Ảnh Đã Sửa Bằng AI**, kèm toàn bộ bài viết tiếng Đức sẵn sàng đăng tải.
