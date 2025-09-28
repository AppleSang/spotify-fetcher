require("dotenv").config();
const express = require("express");
const axios = require("axios");
const protobuf = require("protobufjs");
const OTPAuth = require("otpauth");

// ==========================
// Auth Config (SP_DC + TOTP)
// ==========================
const SP_DC = process.env.SP_DC;
const SECRETS_URL = "https://raw.githubusercontent.com/Thereallo1026/spotify-secrets/refs/heads/main/secrets/secretDict.json";

let currentTotp = null;
let currentTotpVersion = null;
let lastFetchTime = 0;
const FETCH_INTERVAL = 60 * 60 * 1000; // 1h

async function initializeTOTPSecrets() {
  try {
    await updateTOTPSecrets();
  } catch {
    useFallbackSecret();
  }
}
async function updateTOTPSecrets() {
  const now = Date.now();
  if (now - lastFetchTime < FETCH_INTERVAL) return;
  const secrets = await axios.get(SECRETS_URL, {
    timeout: 10000,
    headers: { "User-Agent": "Mozilla/5.0" }
  }).then(res => res.data);
  const newestVersion = Math.max(...Object.keys(secrets).map(Number)).toString();
  if (newestVersion !== currentTotpVersion) {
    const data = secrets[newestVersion];
    const mapped = data.map((v, i) => v ^ ((i % 33) + 9));
    const hex = Buffer.from(mapped.join(""), "utf8").toString("hex");
    const totpSecret = OTPAuth.Secret.fromHex(hex);
    currentTotp = new OTPAuth.TOTP({ period: 30, digits: 6, algorithm: "SHA1", secret: totpSecret });
    currentTotpVersion = newestVersion;
    lastFetchTime = now;
    console.log(`✅ TOTP updated to version ${newestVersion}`);
  }
}
function useFallbackSecret() {
  const fallbackData = [99, 111, 47, 88, 49, 56, 118, 65, 52, 67, 50, 104, 117, 101, 55, 94, 95, 75, 94, 49, 69, 36, 85, 64, 74, 60];
  const mapped = fallbackData.map((v, i) => v ^ ((i % 33) + 9));
  const hex = Buffer.from(mapped.join(""), "utf8").toString("hex");
  const totpSecret = OTPAuth.Secret.fromHex(hex);
  currentTotp = new OTPAuth.TOTP({ period: 30, digits: 6, algorithm: "SHA1", secret: totpSecret });
  currentTotpVersion = "19";
  console.log("⚠️ Using fallback secret");
}
async function getToken(reason = "init", productType = "mobile-web-player") {
  if (!currentTotp) await initializeTOTPSecrets();
  const local = Date.now();
  const server = await axios.get("https://open.spotify.com/api/server-time", {
    headers: { Cookie: `sp_dc=${SP_DC}` }
  }).then(res => Number(res.data.serverTime) * 1000).catch(() => local);
  const payload = {
    reason,
    productType,
    totp: currentTotp.generate({ timestamp: local }),
    totpVer: currentTotpVersion || "19",
    totpServer: currentTotp.generate({ timestamp: server }),
  };
  const url = new URL("https://open.spotify.com/api/token");
  Object.entries(payload).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await axios.get(url.toString(), {
    headers: { Cookie: `sp_dc=${SP_DC}` }
  });
  return res.data?.accessToken;
}

// ==========================
// Proto schema (tích hợp)
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
const EntityCanvazResponse = root.lookupType("com.spotify.canvazcache.EntityCanvazResponse");

// ==========================
// App Config
// ==========================
const app = express();
const PORT = process.env.PORT || 3000;
let spotifyAccessToken = null;
let totalRequests = 0;
let failedRequests = 0;

function updateTerminalTitle() {
  process.stdout.write(`\x1b]0;Spotify Proxy | ✅ ${totalRequests} | ❌ ${failedRequests}\x07`);
}

// ==========================
// Refresh Access Token (TOTP)
// ==========================
async function refreshSpotifyAccessToken() {
  try {
    spotifyAccessToken = await getToken("canvas-lyric");
    console.log("✅ Token refreshed:", spotifyAccessToken.slice(0, 15));
  } catch (err) {
    spotifyAccessToken = null;
    console.error("❌ Failed to refresh token:", err.message);
  }
}
refreshSpotifyAccessToken();
setInterval(refreshSpotifyAccessToken, 1000 * 60); // refresh mỗi phút

// ==========================
// Encode request
// ==========================
function encodeEntityCanvazRequest(trackUri) {
  const CanvazRequest = new protobuf.Type("EntityCanvazRequest").add(
    new protobuf.Field("uris", 1, "string", "repeated")
  );
  const message = CanvazRequest.create({ uris: [trackUri] });
  return CanvazRequest.encode(message).finish();
}

// ==========================
// /canvas
// ==========================
app.get("/canvas", async (req, res) => {
  totalRequests++;
  updateTerminalTitle();
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const { trackId } = req.query;
    if (!trackId) return res.status(400).json({ error: "Missing trackId" });
    if (!spotifyAccessToken) return res.status(500).json({ error: "Access token not ready" });

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
      const meta = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${spotifyAccessToken}` },
      });
      const albumArt = meta.data.album?.images?.[0]?.url;
      if (!albumArt) return res.status(404).json({ error: "No canvas or album art" });
      return res.redirect(albumArt);
    }

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
// /lyric
// ==========================
app.get("/lyric", async (req, res) => {
  totalRequests++;
  updateTerminalTitle();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const { trackId } = req.query;
  if (!trackId) {
    failedRequests++;
    updateTerminalTitle();
    return res.status(400).json({ error: "Missing trackId" });
  }
  if (!spotifyAccessToken) {
    failedRequests++;
    updateTerminalTitle();
    return res.status(500).json({ error: "Access token not ready" });
  }

  try {
    const response = await axios.get(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}`,
      {
        headers: {
          Authorization: `Bearer ${spotifyAccessToken}`,
          "App-Platform": "WebPlayer",
          "User-Agent": "Mozilla/5.0",
        },
        params: { format: "json", market: "from_token" },
      }
    );
    const lines = response.data?.lyrics?.lines;
    if (!lines?.length) return res.status(404).json({ error: "No lyrics found" });
    const lyrics = lines.map((line) => ({
      startTimeMs: line.startTimeMs,
      words: line.words,
    }));
    return res.json({ trackId, lyrics });
  } catch (err) {
    failedRequests++;
    updateTerminalTitle();
    console.error("❌ Lyric error:", err.message);
    res.status(500).json({ error: "Failed to fetch lyrics" });
  }
});

// ==========================
// Redirect fallback
// ==========================
app.use((req, res) => {
  res.redirect("https://applesang.github.io/flowapple/");
});

// ==========================
// Start server
// ==========================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
