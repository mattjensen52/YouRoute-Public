// content.js
console.log("[YouRoute] Content script loaded.");

let lastChannel = null;
const CACHE_DAYS    = 7;
const CACHE_KEY     = "youroute-cache";
const USAGE_KEY     = "youroute-usage";
const DAILY_LIMIT   = 10;
const POLL_INTERVAL = 15000; // 15 seconds

/**
 * Helper to read the extension enabled flag from chrome.storage.local
 * @return {Promise<boolean>}
 */
function getEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get({ enabled: true }, result => {
      resolve(result.enabled);
    });
  });
}

// Main loop
async function runExtensionLogic() {
  // Check ON/OFF toggle
  const enabled = await getEnabled();
  if (!enabled) {
    console.log("[YouRoute] Extension is OFF");
    return;
  }

  // Detect Twitch username change
  const match = window.location.pathname.match(/^\/([a-zA-Z0-9_]+)$/);
  const twitchUsername = match?.[1]?.toLowerCase() || null;
  if (!twitchUsername || twitchUsername === lastChannel) return;
  lastChannel = twitchUsername;
  console.log(`[YouRoute] Detected channel: ${twitchUsername}`);

  // Enforce local daily quota
  const today = new Date().toISOString().split("T")[0];
  const usage = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
  const todayCount = usage[today] || 0;
  if (todayCount >= DAILY_LIMIT) {
    console.log(`[YouRoute] Local daily API limit reached (${DAILY_LIMIT})`);
    return;
  }

  // Check 7-day cache
  const localCache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  const cached = localCache[twitchUsername];
  const now = Date.now();
  if (cached && now - cached.lastChecked < CACHE_DAYS * 24 * 60 * 60 * 1000) {
    console.log("[YouRoute] Using local cache:", cached);
    if (cached.isLive) showBanner(cached.youtubeUrl);
    return;
  }

  // Wait until YouTube links are in the DOM
  await waitForDOM();
  const links = [...document.querySelectorAll("a[href*='youtube.com']")]
    .map(a => a.href);
  console.log("[YouRoute] Found YouTube links:", links);
  if (!links.length) return;

  // Pick the best YouTube link
  const bestLink = pickBestYoutubeLink(links, twitchUsername);
  if (!bestLink) return;
  console.log("[YouRoute] Selected YouTube link:", bestLink);

  // Call Firebase cloud function
  const params = new URLSearchParams({
    twitch: twitchUsername,
    ytUrl:  bestLink.split(/[?#]/)[0] // strip query/hash
  });

  try {
    const response = await fetch(
      `https://checkstreamer-rqozvgm72a-uc.a.run.app?${params}`
    );
    const data = await response.json();
    console.log("[YouRoute] Firebase response:", data);

    // Increment local daily usage
    usage[today] = todayCount + 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));

    // Update 7-day cache
    localCache[twitchUsername] = {
      youtubeUrl:  data.youtubeUrl,
      isLive:      data.isLive,
      channelId:   data.channelId,
      lastChecked: now
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(localCache));

    // Show banner if live
    if (data.isLive) showBanner(data.youtubeUrl);
  } catch (err) {
    console.error("[YouRoute] Error calling Firebase:", err);
  }
}

/**
 * Pick the most likely correct YouTube link:
 * 1. Exact match (/username)
 * 2. Partial match
 * 3. First link
 */
function pickBestYoutubeLink(links, twitchUsername) {
  const lower = twitchUsername.toLowerCase();
  const exact = links.find(l => l.toLowerCase().includes(`/${lower}`));
  if (exact) return exact;
  const partial = links.find(l => l.toLowerCase().includes(lower));
  if (partial) return partial;
  return links[0];
}

/**
 * Wait up to ~10 seconds for YouTube links to appear in the DOM.
 * @param {number} retries
 * @return {Promise<void>}
 */
function waitForDOM(retries = 20) {
  return new Promise(resolve => {
    const check = () => {
      if (document.querySelector("a[href*='youtube.com']") || retries <= 0) {
        resolve();
      } else {
        retries--;
        setTimeout(check, 500);
      }
    };
    check();
  });
}

/**
 * Display a dismissible banner in the bottom-right.
 * @param {string} youtubeUrl
 */
function showBanner(youtubeUrl) {
  if (document.getElementById("youroute-banner")) return;

  const banner = document.createElement("div");
  banner.id = "youroute-banner";
  banner.style = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #ff0000;
    color: white;
    padding: 10px 15px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 99999;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    gap: 10px;
  `;

  const text = document.createElement("span");
  text.innerHTML = 
    `📺 Also live on <a href="${youtubeUrl}" target="_blank"` +
    ` style="color: white; text-decoration: underline;">YouTube</a>`;

  const close = document.createElement("span");
  close.innerText = "✕";
  close.style = "cursor: pointer; font-weight: bold;";
  close.onclick = () => banner.remove();

  banner.append(text, close);
  document.body.appendChild(banner);
}

// Start the loop
runExtensionLogic();
setInterval(runExtensionLogic, POLL_INTERVAL);
