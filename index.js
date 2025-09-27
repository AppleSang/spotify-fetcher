require("dotenv").config();
const express = require("express");
const axios = require("axios");
const protobuf = require("protobufjs");
const OTPAuth = require("otpauth");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// Proto schema (tích hợp thẳng)
// ==========================
const root = protobuf.Root.fromJSON({
  nested: {
    com: {
      nested: {
        spotify: {
          nested: {
            canvazcache: {
              nested: {
                EntityCanvazResponse: {
                  fields: {
                    canvases: { rule: "repeated", type: "Canvaz", id: 1 },
                    ttlInSeconds: { type: "int64", id: 2 },
                  },
                  nested: {
                    Canvaz: {
                      fields: {
                        id: { type: "string", id: 1 },
                        url: { type: "string", id: 2 },
                        fileId: { type: "string", id: 3 },
                        type: { type: "int32", id: 4 },
                        entityUri: { type: "string", id: 5 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

const EntityCanvazResponse = root.lookupType(
  "com.spotify.canvazcache.EntityCanvazResponse"
);

// ==========================
// Biến toàn cục
// ==========================
let spotifyAccessToken = null;
let totalRequests = 0;
let failedRequests = 0;

// ==========================
// Helper
// ==========================
function updateTerminalTitle() {
  process.stdout.write(
    `\x1b]0;Spotify Fetcher | ✅ ${totalRequests} | ❌ ${failedRequests}\x07`
  );
}

function encodeEntityCanvazRequest(trackUri) {
  // request tối giản (theo protobuf structure của Spotify)
  const CanvazRequest = new protobuf.Type("EntityCanvazRequest").add(
    new protobuf.Field("uris", 1, "string", "repeated")
  );
  const message = CanvazRequest.create({ uris: [trackUri] });
  return CanvazRequest.encode(message).finish();
}

// ==========================
// Refresh access_token từ sp_dc
// ==========================
async function refreshAccessToken() {
  try {
    const cookie = process.env.SP_DC;
    if (!cookie) {
      console.error("❌ Thiếu SP_DC trong environment variable");
      return;
    }

    const res = await axios.get("https://open.spotify.com/get_access_token", {
      headers: { Cookie: `sp_dc=${cookie}` },
    });

    spotifyAccessToken = res.data.accessToken;
    console.log("✅ Access token refreshed:", spotifyAccessToken.slice(0, 15));
  } catch (err) {
    console.error("❌ Failed to refresh token:", err.message);
  }
}

setInterval(refreshAccessToken, 1000 * 60 * 10); // 10 phút
refreshAccessToken();

// ==========================
// API route: /spotify/canvas
// ==========================
app.get("/spotify/canvas", async (req, res) => {
  totalRequests++;
  updateTerminalTitle();
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const { trackId } = req.query;
    if (!trackId) return res.status(400).json({ error: "Missing trackId" });
    if (!spotifyAccessToken)
      return res.status(500).json({ error: "Access token not ready" });

    const trackUri = `spotify:track:${trackId}`;
    const body = encodeEntityCanvazRequest(trackUri);

    let canvasUrl = null;

    try {
      const response = await axios.post(
        "https://gue1-spclient.spotify.com/canvaz-cache/v0/canvases",
        body,
        {
          headers: {
            Authorization: `Bearer ${spotifyAccessToken}`,
            "Content-Type": "application/x-protobuf",
          },
          responseType: "arraybuffer",
        }
      );

      const decoded = EntityCanvazResponse.decode(new Uint8Array(response.data));
      const urls = decoded.canvases.map((c) => c.url).filter(Boolean);
      canvasUrl = urls[0] || null;
    } catch {
      console.warn("⚠️ No canvas found, fallback album art");
    }

    if (!canvasUrl) {
      // fallback: lấy album art
      const meta = await axios.get(
        `https://api.spotify.com/v1/tracks/${trackId}`,
        { headers: { Authorization: `Bearer ${spotifyAccessToken}` } }
      );
      const albumArt = meta.data.album?.images?.[0]?.url;
      if (!albumArt)
        return res.status(404).json({ error: "No canvas or album art" });
      return res.redirect(albumArt);
    }

    // 🔥 stream canvas video trực tiếp về client
    const video = await axios.get(canvasUrl, { responseType: "stream" });
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "no-store");
    video.data.pipe(res);
  } catch (err) {
    failedRequests++;
    updateTerminalTitle();
    console.error("❌ Canvas error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// Start server (local only)
// ==========================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
