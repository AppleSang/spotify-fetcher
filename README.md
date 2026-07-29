# <p align=center> Spotify Canvas & Lyrics Fetcher</p>
> English is [here](https://github.com/AppleSang/spotify-fetcher#-english)

## 🇻🇳 Tiếng Việt

### Giới thiệu

**Spotify Canvas & Lyrics Fetcher** là một API server giúp lấy **Canvas** (video ngắn 3-8 giây của bài hát trên Spotify) và **lyrics có thời gian** (synced lyrics) cho bất kỳ track Spotify nào.

API này sử dụng `sp_dc` cookie kết hợp với TOTP authentication để lấy access token, sau đó gọi các internal API của Spotify để lấy dữ liệu.

### Tính năng

- 🎬 Lấy Canvas video cho bất kỳ track Spotify nào
- 📝 Lấy synced lyrics (từ khóa + thời gian bắt đầu)
- 🔄 Tự động refresh access token mỗi phút
- 🛡️ TOTP token tự động cập nhật từ remote secrets
- 🖼️ Fallback về album art khi track không có Canvas
- 🌍 Hỗ trợ CORS (có thể gọi từ browser)
- 🚀 Có thể deploy lên Vercel, Node.js server thông thường

### Kiến trúc

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Client     │────▶│  Your Server  │────▶│  Spotify API     │
│  (Browser/   │     │  (Express)    │     │  (Internal API)  │
│   App)       │     └──────────────┘     └──────────────────┘
└─────────────┘              │
                             ▼
                    ┌─────────────────┐
                    │ Spotify Secrets  │
                    │ (GitHub Raw)     │
                    └─────────────────┘
```

### Workflow chi tiết

```
1. Khởi động server
   │
   ├── Tải TOTP secret từ remote GitHub
   ├── Giải mã secret (XOR decode)
   └── Tạo TOTP object để sinh token
   │
2. Mỗi phút: Refresh Spotify access token
   │
   ├── Lấy server time từ Spotify
   ├── Sinh TOTP code (local + server time)
   ├── Gửi request đến /api/token với sp_dc cookie
   └── Nhận accessToken
   │
3. Client gọi API endpoint
   │
   ├── GET /spotify/canvas?trackId=xxx  hoặc  GET /canvas?trackId=xxx
   │   │
   │   ├── Encode track URI thành Protobuf format
   │   ├── Gọi canvaz-cache API
   │   ├── Decode Protobuf response
   │   ├── Nếu có canvas → stream video MP4 về client
   │   └── Nếu không có → redirect về album art
   │
   └── GET /spotify/lyric?trackId=xxx  hoặc  GET /lyric?trackId=xxx
       │
       ├── Gọi color-lyrics API
       ├── Parse lyrics lines
       └── Trả về JSON { trackId, lyrics: [{startTimeMs, words}] }
```

### Cài đặt

```bash
# Clone repository
git clone https://github.com/yourusername/spotify-fetcher.git
cd spotify-fetcher

# Cài dependencies
npm install

# Tạo file .env
echo "SP_DC=your_sp_dc_cookie_here" > .env
echo "PORT=3690" >> .env

# Chạy server
npm start
```

### Biến môi trường

| Biến | Mô tả | Bắt buộc |
|------|-------|----------|
| `SP_DC` | Cookie sp_dc từ Spotify | ✅ Có |
| `PORT` | Port chạy server (mặc định: 3690 hoặc 3000) | ❌ Không |

### Cách lấy `sp_dc` cookie

1. Đăng nhập [Spotify Web Player](https://open.spotify.com)
2. Mở DevTools (F12) → Application → Cookies → `https://open.spotify.com`
3. Copy giá trị của cookie `sp_dc`
4. Dán vào file `.env`

> **Mẹo:** Bạn có thể dùng extension browser như "Cookie Editor" để dễ dàng copy.

### API Endpoints

#### GET /spotify/canvas?trackId={trackId}
*(hoặc GET /canvas?trackId=xxx nếu dùng index.js)*

Lấy Canvas video cho track.

**Response:**
- Thành công: Stream video MP4 (content-type: video/mp4)
- Không có canvas: Redirect về ảnh album art
- Lỗi: `{"error": "..."}`

**Ví dụ:**
```bash
curl -O "http://localhost:3690/spotify/canvas?trackId=3n3Ppam7egaQ1gAVV2Ejro"
```

#### GET /spotify/lyric?trackId={trackId}
*(hoặc GET /lyric?trackId=xxx nếu dùng index.js)*

Lấy synced lyrics.

**Response:**
```json
{
  "trackId": "3n3Ppam7egaQ1gAVV2Ejro",
  "lyrics": [
    {
      "startTimeMs": "12000",
      "words": "Lyric word 1"
    },
    {
      "startTimeMs": "45000",
      "words": "Lyric word 2"
    }
  ]
}
```

**Ví dụ:**
```bash
curl "http://localhost:3690/spotify/lyric?trackId=3n3Ppam7egaQ1gAVV2Ejro"
```

---

## 🇬🇧 English

### Introduction

**Spotify Canvas & Lyrics Fetcher** is an API server that fetches **Spotify Canvas** (short 3-8 second videos for songs) and **synced lyrics** (time-synced lyrics) for any Spotify track.

The API uses `sp_dc` cookie combined with TOTP authentication to obtain an access token, then calls Spotify's internal APIs to retrieve data.

### Features

- 🎬 Fetch Canvas videos for any Spotify track
- 📝 Fetch synced lyrics (keywords + start timestamps)
- 🔄 Automatic access token refresh every minute
- 🛡️ TOTP token auto-updates from remote secrets
- 🖼️ Fallback to album art when no Canvas exists
- 🌍 CORS enabled (callable from browsers)
- 🚀 Deployable on Vercel, standard Node.js server

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Client     │────▶│  Your Server  │────▶│  Spotify API     │
│  (Browser/   │     │  (Express)    │     │  (Internal API)  │
│   App)       │     └──────────────┘     └──────────────────┘
└─────────────┘              │
                             ▼
                    ┌─────────────────┐
                    │ Spotify Secrets  │
                    │ (GitHub Raw)     │
                    └─────────────────┘
```

### Detailed Workflow

```
1. Server startup
   │
   ├── Load TOTP secret from remote GitHub
   ├── Decode secret (XOR decode)
   └── Create TOTP object for token generation
   │
2. Every minute: Refresh Spotify access token
   │
   ├── Fetch server time from Spotify
   ├── Generate TOTP codes (local + server time)
   ├── Send request to /api/token with sp_dc cookie
   └── Receive accessToken
   │
3. Client calls API endpoint
   │
   ├── GET /spotify/canvas?trackId=xxx  or  GET /canvas?trackId=xxx
   │   │
   │   ├── Encode track URI to Protobuf format
   │   ├── Call canvaz-cache API
   │   ├── Decode Protobuf response
   │   ├── If canvas exists → stream MP4 video to client
   │   └── If no canvas → redirect to album art
   │
   └── GET /spotify/lyric?trackId=xxx  or  GET /lyric?trackId=xxx
       │
       ├── Call color-lyrics API
       ├── Parse lyrics lines
       └── Return JSON { trackId, lyrics: [{startTimeMs, words}] }
```

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/spotify-fetcher.git
cd spotify-fetcher

# Install dependencies
npm install

# Create .env file
echo "SP_DC=your_sp_dc_cookie_here" > .env
echo "PORT=3690" >> .env

# Start server
npm start
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SP_DC` | Spotify sp_dc cookie | ✅ Yes |
| `PORT` | Server port (default: 3690 or 3000) | ❌ No |

### How to get `sp_dc` cookie

1. Login to [Spotify Web Player](https://open.spotify.com)
2. Open DevTools (F12) → Application → Cookies → `https://open.spotify.com`
3. Copy the value of `sp_dc` cookie
4. Paste into `.env` file

> **Tip:** Use a browser extension like "Cookie Editor" to easily copy cookies.

### API Endpoints

#### GET /spotify/canvas?trackId={trackId}
*(or GET /canvas?trackId=xxx if using index.js)*

Fetch Canvas video for a track.

**Response:**
- Success: MP4 video stream (content-type: video/mp4)
- No canvas: Redirect to album art image
- Error: `{"error": "..."}`

**Example:**
```bash
curl -O "http://localhost:3690/spotify/canvas?trackId=3n3Ppam7egaQ1gAVV2Ejro"
```

#### GET /spotify/lyric?trackId={trackId}
*(or GET /lyric?trackId=xxx if using index.js)*

Fetch synced lyrics.

**Response:**
```json
{
  "trackId": "3n3Ppam7egaQ1gAVV2Ejro",
  "lyrics": [
    {
      "startTimeMs": "12000",
      "words": "Lyric word 1"
    },
    {
      "startTimeMs": "45000",
      "words": "Lyric word 2"
    }
  ]
}
```

**Example:**
```bash
curl "http://localhost:3690/spotify/lyric?trackId=3n3Ppam7egaQ1gAVV2Ejro"
```

---

## 📁 File Structure

```
spotify-fetcher/
├── index.js          # ESM version (main entry point)
├── main.js           # CommonJS version (alternative)
├── backup_index.js   # Vercel serverless fallback handler
├── schema.proto      # Protobuf schema for Canvas response
├── package.json      # Dependencies & scripts
├── vercel.json       # Vercel deployment config
├── sec.json          # Local TOTP secrets backup
└── secretDict.json   # Local version of remote secrets
```

## 🔧 How Authentication Works

1. **TOTP Secrets** are fetched from a remote GitHub repo and decoded using XOR
2. **Access Token** is obtained by sending TOTP codes + `sp_dc` cookie to Spotify's token API
3. **Token refreshes** every 60 seconds automatically
4. **Protobuf encoding** is used for Canvas requests (Spotify's internal format)

## 🚀 Deployment

### Vercel

```bash
npm i -g vercel
vercel deploy
```

Or connect your GitHub repo to Vercel for auto-deploy.

### Docker (optional)

Create a `Dockerfile`:
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3690
CMD ["npm", "start"]
```

---

## ⚠️ Notes

- `sp_dc` cookie expires periodically — you may need to refresh it
- Canvas availability depends on the artist/label
- Rate limits may apply for high-traffic usage
- This uses Spotify's **internal/unofficial** APIs

## 📄 License

MIT

## 🙏 Credits

Based on concepts from [spot-secrets-go](https://github.com/xyloflake/spot-secrets-go)
