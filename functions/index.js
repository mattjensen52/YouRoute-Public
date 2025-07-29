const {onRequest} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();
const app = express();
app.use(express.json());

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const HOURS_TO_WAIT = 24 * 7;
const DAILY_LIMIT = 10;

app.get("/", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET");

  // Ip Throttling
  // IP rate limiting: max 10 calls per IP per day
  const ip = (req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() || req.socket.remoteAddress;
  const today = new Date().toISOString().split("T")[0];
  const ipRef = db.collection("ipUsage").doc(ip);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ipRef);
      let date = snap.exists ? snap.data().date : today;
      let count = snap.exists ? snap.data().count : 0;

      if (date !== today) {
        date = today;
        count = 0;
      }

      if (count >= DAILY_LIMIT) {
        throw new Error("DAILY_LIMIT_EXCEEDED");
      }

      tx.set(ipRef, {date: date, count: count + 1});
    });
  } catch (err) {
    if (err.message === "DAILY_LIMIT_EXCEEDED") {
      return res.status(429).json({error: "Daily limit exceeded"});
    }
    console.error("IP throttle error:", err);
    return res.status(500).json({error: "Internal error"});
  }


  const twitch = (req.query.twitch || "").toLowerCase();
  const ytUrl = req.query.ytUrl;
  if (!twitch || !ytUrl) {
    return res.status(400).json({error: "Missing twitch or ytUrl"});
  }

  try {
    // Firestore cache
    const docRef = db.collection("streamerLinks").doc(twitch);
    const docSnap = await docRef.get();
    const now = new Date();

    if (docSnap.exists) {
      const data = docSnap.data();
      const lastChecked = new Date(data.lastChecked);
      const hoursSince = (now - lastChecked) / (1000 * 60 * 60);
      if (hoursSince < HOURS_TO_WAIT) {
        return res.json({
          twitch,
          youtubeUrl: data.youtubeUrl,
          isLive: data.isLiveCached || false,
          channelId: data.channelId,
          cached: true,
        });
      }
    }

    // Resolve channelId
    const channelId = await resolveChannelId(ytUrl);
    if (!channelId) {
      return res.status(404).json({error: "Invalid YouTube URL"});
    }

    // Check live
    const isLive = await checkIfLive(channelId);

    // Save back to Firestore
    await docRef.set({
      twitch,
      channelId,
      youtubeUrl: ytUrl,
      verified: true,
      isLiveCached: isLive,
      lastChecked: now.toISOString(),
    });

    return res.json({
      twitch,
      youtubeUrl: ytUrl,
      isLive,
      channelId,
      cached: false,
    });
  } catch (err) {
    console.error("checkStreamer error:", err);
    return res.status(500).json({error: "Internal error"});
  }
});

exports.checkStreamer = onRequest(app);

/**
 * Resolve a YouTube channel ID from various URL formats.
 * @param {string} url The YouTube channel URL or handle.
 * @return {Promise<string|null>} The channel ID or null.
 */
async function resolveChannelId(url) {
  try {
    if (url.includes("/channel/")) {
      return url.split("/channel/")[1].split(/[/?#]/)[0];
    } else if (url.includes("/@")) {
      const handle = url.split("/@")[1].split(/[/?#]/)[0];
      return await searchYouTubeChannel(handle);
    } else {
      const parts = url.split("youtube.com/");
      if (parts.length > 1) {
        const name = parts[1].split(/[/?#]/)[0];
        return await searchYouTubeChannel(name);
      }
    }
  } catch (err) {
    console.error("resolveChannelId error:", err);
  }
  return null;
}

/**
 * Search YouTube for a channel by handle or custom name.
 * @param {string} query The handle or custom channel name.
 * @return {Promise<string|null>} The resolved channel ID or null.
 */
async function searchYouTubeChannel(query) {
  const res = await axios.get(
      `https://www.googleapis.com/youtube/v3/search?part=snippet` +
    `&q=${encodeURIComponent(query)}&type=channel&key=${YOUTUBE_API_KEY}`,
  );
  const item = res.data.items && res.data.items[0];
  return item && item.snippet && item.snippet.channelId || null;
}

/**
 * Check if a YouTube channel is currently live.
 * @param {string} channelId The YouTube channel ID.
 * @return {Promise<boolean>} True if live, false otherwise.
 */
async function checkIfLive(channelId) {
  const res = await axios.get(
      `https://www.googleapis.com/youtube/v3/search?part=snippet` +
    `&channelId=${channelId}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`,
  );
  return Array.isArray(res.data.items) && res.data.items.length > 0;
}
