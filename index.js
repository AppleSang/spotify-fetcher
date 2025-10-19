import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import protobuf from 'protobufjs';
import * as OTPAuth from 'otpauth';

// ==== Config ====
const SP_DC = process.env.SP_DC;
const SECRETS_URL = "https://github.com/xyloflake/spot-secrets-go/blob/main/secrets/secretDict.json?raw=true";
const PORT = process.env.PORT || 3000;

let currentTotp = null;
let currentTotpVersion = null;
let lastFetchTime = 0;
const FETCH_INTERVAL = 60 * 60 * 1000; // 1h

// ==== TOTP ====
async function initializeTOTPSecrets() {
  try {
    await updateTOTPSecrets();
  } catch (err) {
    console.warn("⚠️ Failed to fetch TOTP secrets:", err.message);
    useFallbackSecret();
  }
}

async function updateTOTPSecrets() {
  const now = Date.now();
  if (now - lastFetchTime < FETCH_INTERVAL) return;

  console.log("⏳ Fetching TOTP secrets...");
  const secrets = await axios.get(SECRETS_URL, { timeout: 10000 }).then(r => r.data);

  const newestVersion = Math.max(...Object.keys(secrets).map(Number)).toString();
  if (newestVersion !== currentTotpVersion) {
    const data = secrets[newestVersion];
    const mapped = data.map((v,i) => v ^ ((i%33)+9));
    const hex = Buffer.from(mapped.join(""), "utf8").toString("hex");
    const totpSecret = OTPAuth.Secret.fromHex(hex);
    currentTotp = new OTPAuth.TOTP({ period:30, digits:6, algorithm:"SHA1", secret:totpSecret });
    currentTotpVersion = newestVersion;
    lastFetchTime = now;
    console.log(`✅ TOTP updated to version ${newestVersion}`);
  }
}

function useFallbackSecret() {
  const fallbackData = [99,111,47,88,49,56,118,65,52,67,50,104,117,101,55,94,95,75,94,49,69,36,85,64,74,60];
  const mapped = fallbackData.map((v,i) => v ^ ((i%33)+9));
  const hex = Buffer.from(mapped.join(""), "utf8").toString("hex");
  const totpSecret = OTPAuth.Secret.fromHex(hex);
  currentTotp = new OTPAuth.TOTP({ period:30, digits:6, algorithm:"SHA1", secret:totpSecret });
  currentTotpVersion = "19";
  console.log("⚠️ Using fallback secret");
}

// ==== Get Spotify Token ====
async function getToken() {
  if (!currentTotp) await initializeTOTPSecrets();

  const local = Date.now();
  let serverTime = local;

  try {
    const res = await axios.get("https://open.spotify.com/api/server-time", {
      headers: { Cookie: `sp_dc=${SP_DC}` }
    });
    serverTime = Number(res.data.serverTime)*1000;
    console.log("✅ Server time fetched:", new Date(serverTime).toISOString());
  } catch(err) {
    console.warn("⚠️ Failed to get server time, using local time:", err.message);
  }

  const payload = {
    reason: "canvas-lyric",
    productType: "mobile-web-player",
    totp: currentTotp.generate({ timestamp: local }),
    totpVer: currentTotpVersion || "19",
    totpServer: currentTotp.generate({ timestamp: serverTime }),
  };

  const url = new URL("https://open.spotify.com/api/token");
  Object.entries(payload).forEach(([k,v])=>url.searchParams.append(k,v));

  console.log("⏳ Requesting Spotify access token...");
  const res = await axios.get(url.toString(), { headers: { Cookie: `sp_dc=${SP_DC}` } });
  if (!res.data?.accessToken) throw new Error("No accessToken returned");
  console.log("✅ Spotify access token obtained");
  return res.data.accessToken;
}

// ==== Express App ====
const app = express();
let spotifyAccessToken = "";

// ==== Inline Protobuf Schema ====
const protoSchema = `
syntax = "proto3";
package com.spotify.canvazcache;

message EntityCanvazResponse {
  repeated Canvaz canvases = 1;
  int64 ttlInSeconds = 2;
  message Canvaz {
    string id = 1;
    string url = 2;
    string fileId = 3;
    int32 type = 4;
    string entityUri = 5;
  }
}
`;
const root = protobuf.parse(protoSchema).root;
const EntityCanvazResponse = root.lookupType("com.spotify.canvazcache.EntityCanvazResponse");

// ==== Refresh Spotify Token ====
async function refreshSpotifyAccessToken() {
  try {
    spotifyAccessToken = await getToken();
  } catch(err) {
    console.error("❌ Failed to get token:", err.message);
  }
}
await refreshSpotifyAccessToken();
setInterval(refreshSpotifyAccessToken, 60000);

// ==== Encode Track URI ====
function encodeEntityCanvazRequest(trackUri) {
  const uriBytes = new TextEncoder().encode(trackUri);
  return new Uint8Array([0x0a, uriBytes.length + 2, 0x0a, uriBytes.length, ...uriBytes]);
}

// ==== /canvas endpoint ====
app.get("/canvas", async (req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  const { trackId } = req.query;
  if (!trackId) return res.status(400).json({ error:"Missing trackId" });
  if (!spotifyAccessToken) return res.status(500).json({ error:"Access token not ready" });

  let canvasUrl = null;

  // === Try Canvas ===
  try {
    const body = encodeEntityCanvazRequest(`spotify:track:${trackId}`);
    console.log("⏳ Requesting canvas for track:", trackId);

    const response = await axios.post(
      "https://gue1-spclient.spotify.com/canvaz-cache/v0/canvases",
      body,
      { headers:{ Authorization:`Bearer ${spotifyAccessToken}`, "Content-Type":"application/x-protobuf"}, responseType:"arraybuffer"}
    );

    const decoded = EntityCanvazResponse.decode(new Uint8Array(response.data));
    const errMsg = EntityCanvazResponse.verify(decoded);
    if (errMsg) throw new Error("Protobuf verify failed: "+errMsg);

    canvasUrl = decoded.canvases.map(c=>c.url).filter(Boolean)[0] || null;
    console.log("✅ Canvas URLs found:", decoded.canvases.map(c=>c.url));
  } catch(err) {
    console.error("⚠️ Canvas fetch failed:", err.response?.data || err.message);
  }

  // === Fallback: album art ===
  if (!canvasUrl) {
    try {
      console.log("⏳ Falling back to album art for track:", trackId);
      const meta = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { Authorization: `Bearer ${spotifyAccessToken}` },
      });
      const albumArt = meta.data.album?.images?.[0]?.url;
      if (albumArt) {
        canvasUrl = albumArt;
        console.log("✅ Album art URL:", albumArt);
      }
    } catch(err) {
      console.error("⚠️ Album art fetch failed:", err.message);
    }
  }

  if (canvasUrl) return res.redirect(canvasUrl);
  return res.status(404).json({ error:"No canvas or album art" });
});

// ==== /lyric endpoint ====
app.get("/lyric", async (req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Content-Type","application/json; charset=utf-8");

  const { trackId } = req.query;
  if (!trackId) return res.status(400).json({ error:"Missing trackId" });
  if (!spotifyAccessToken) return res.status(500).json({ error:"Access token not ready" });

  try {
    const response = await axios.get(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}`,
      { headers:{ Authorization:`Bearer ${spotifyAccessToken}`, "App-Platform":"WebPlayer" }, params:{ format:"json", market:"from_token" } }
    );

    const lines = response.data?.lyrics?.lines;
    if (!lines?.length) return res.status(404).json({ error:"No lyrics found" });

    const lyrics = lines.map(l=>({ startTimeMs:l.startTimeMs, words:l.words }));
    return res.json({ trackId, lyrics });
  } catch(err) {
    console.error("❌ Lyric error:", err.response?.data || err.message);
    res.status(500).json({ error:"Failed to fetch lyrics" });
  }
});

// ==== Catch-all redirect ====
app.use((req,res)=>{
  console.log("🌐 Unknown request path, redirecting to flowapple:", req.originalUrl);
  res.redirect("https://applesang.github.io/flowapple");
});

// ==== Start Server ====
app.listen(PORT, ()=>console.log(`🎧 Server running at http://localhost:${PORT}`));
