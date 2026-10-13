const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const SPOTIFY_API = "https://api.spotify.com/v1/browse/categories";
const SPOTIFY_BROWSE_PAGE = "https://open.spotify.com/genre";

const FALLBACK_CATEGORIES = [
  { id: "pop", name: "Pop" },
  { id: "hiphop", name: "Hip-Hop" },
  { id: "rock", name: "Rock" },
  { id: "edm_dance", name: "Dance/Electronic" },
  { id: "rnb", name: "R&B" },
  { id: "indie_alt", name: "Indie" },
  { id: "mood", name: "Mood" },
  { id: "party", name: "Party" },
  { id: "chill", name: "Chill" },
  { id: "workout", name: "Workout" },
  { id: "focus", name: "Focus" },
  { id: "sleep", name: "Sleep" },
  { id: "romance", name: "Romance" },
  { id: "decades", name: "Decades" },
  { id: "classical", name: "Classical" },
  { id: "jazz", name: "Jazz" },
  { id: "country", name: "Country" },
  { id: "latin", name: "Latin" },
  { id: "reggae", name: "Reggae" },
  { id: "metal", name: "Metal" },
];

function normalizeCategory(category, index, source) {
  const image = Array.isArray(category.icons) ? category.icons.find((item) => item?.url)?.url : null;
  return {
    id: String(category.id || category.href || category.name || `category-${index}`).replace(/^.*category[:/]/, ""),
    name: String(category.name || category.title || "Untitled category"),
    description: category.description || "",
    coverImage: image || category.coverImage || "",
    color: "#1DB954",
    order: index,
    source,
    isStatic: source === "static-fallback",
  };
}

async function spotifyAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Spotify token request failed (${response.status})`);
  const data = await response.json();
  return data.access_token || null;
}

async function fetchOfficialCategories(token, country) {
  const categories = [];
  let offset = 0;
  const limit = 50;

  for (let page = 0; page < 10; page += 1) {
    const url = new URL(SPOTIFY_API);
    url.searchParams.set("country", country);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Spotify categories request failed (${response.status})`);
    const payload = await response.json();
    const pageItems = payload.categories?.items || [];
    categories.push(...pageItems);
    if (!pageItems.length || !payload.categories?.next) break;
    offset += pageItems.length;
  }

  return categories;
}

function collectCategories(value, out, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (!Array.isArray(value) && (value.type === "category" || value.__typename === "Category") && (value.name || value.title)) {
    out.push(value);
  }
  if (!Array.isArray(value) && value.id && (value.name || value.title) && /category/i.test(String(value.uri || value.type || value.__typename || ""))) {
    out.push(value);
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectCategories(child, out, seen);
  }
}

async function fetchPublicBrowseCategories() {
  const response = await fetch(SPOTIFY_BROWSE_PAGE, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RESONATE-Catalogue/1.0)",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Spotify public browse page failed (${response.status})`);
  const html = await response.text();
  const found = [];

  for (const match of html.matchAll(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectCategories(JSON.parse(match[1]), found); } catch {}
  }
  for (const match of html.matchAll(/"id":"([^"]+)","name":"([^"]+)","icons":\[([^\]]*)\]/g)) {
    const icons = [...match[3].matchAll(/"url":"([^"]+)"/g)].map((item) => ({ url: item[1].replace(/\\u0026/g, "&") }));
    found.push({ id: match[1], name: match[2], icons });
  }

  const unique = new Map();
  for (const item of found) {
    const id = item.id || item.uri;
    const name = item.name || item.title;
    if (id && name) unique.set(String(id), { ...item, id: String(id), name: String(name) });
  }
  if (!unique.size) throw new Error("No category records were exposed by Spotify's public browse page");
  return [...unique.values()];
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET") return send(res, 405, { success: false, error: "Method not allowed" });

  const country = String(req.query?.country || "IN").toUpperCase().slice(0, 2);
  const errors = [];

  try {
    const token = await spotifyAccessToken();
    if (token) {
      try {
        const categories = await fetchOfficialCategories(token, country);
        if (categories.length) {
          const data = categories.map((item, index) => normalizeCategory(item, index, "spotify-web-api"));
          return send(res, 200, { success: true, data, count: data.length, source: "spotify-web-api", country });
        }
      } catch (error) { errors.push({ source: "spotify-web-api", message: error.message }); }
    } else {
      errors.push({ source: "spotify-web-api", message: "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not configured" });
    }
  } catch (error) {
    errors.push({ source: "spotify-web-api", message: error.message });
  }

  try {
    const categories = await fetchPublicBrowseCategories();
    if (categories.length) {
      const data = categories.map((item, index) => normalizeCategory(item, index, "spotify-public-browse"));
      return send(res, 200, { success: true, data, count: data.length, source: "spotify-public-browse", country, warnings: errors });
    }
  } catch (error) {
    errors.push({ source: "spotify-public-browse", message: error.message });
  }

  // Spotify category browsing is unavailable without valid credentials, so
  // keep the fallback category list but enrich each card with real Apple catalogue artwork.
  async function lookupArtwork(category) {
    const params = new URLSearchParams({
      term: category.term,
      entity: "musicTrack",
      limit: "1",
      country,
    });
    try {
      const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) return "";
      const payload = await response.json();
      const artwork = payload.results?.find((item) => item.artworkUrl100)?.artworkUrl100 || "";
      return artwork.replace(/\\/\\d+x\\d+bb\\.(jpg|png|jpeg)(\\?.*)?$/i, "/600x600bb.$1$2");
    } catch {
      return "";
    }
  }

  const enrichedCategories = [];
  for (let start = 0; start < FALLBACK_CATEGORIES.length; start += 5) {
    const batch = FALLBACK_CATEGORIES.slice(start, start + 5);
    const results = await Promise.all(batch.map(async (item, offset) => ({
      ...item,
      description: "",
      coverImage: await lookupArtwork({
        ...item,
        term: ({
          pop: "pop hits", hiphop: "hip hop hits", rock: "rock hits",
          edm_dance: "electronic dance music", rnb: "rnb soul hits",
          indie_alt: "indie alternative hits", mood: "mood music hits",
          party: "party hits", chill: "chill relaxing music",
          workout: "workout motivation music", focus: "focus concentration music",
          sleep: "sleep ambient music", romance: "romantic love songs",
          decades: "greatest hits classic songs", classical: "classical music",
          jazz: "jazz classics", country: "country music hits", latin: "latin music hits",
          reggae: "reggae hits", metal: "heavy metal music",
        })[item.id] || item.name,
      }),
      color: "#1DB954",
      order: start + offset,
      source: "apple-itunes-artwork",
      isStatic: true,
    })));
    enrichedCategories.push(...results);
  }

  const withArtwork = enrichedCategories.filter((item) => item.coverImage).length;
  return send(res, 200, {
    success: true,
    data: enrichedCategories,
    count: enrichedCategories.length,
    source: "apple-itunes-artwork",
    country,
    warning: "Fallback genre categories are shown with artwork from Apple's public iTunes catalogue; these are not live Spotify Browse categories.",
    diagnostics: [
      ...errors,
      { source: "apple-itunes-artwork", message: `${withArtwork}/${enrichedCategories.length} categories have artwork` },
    ],
  });
}
