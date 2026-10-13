const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const JIOSAAVN_API = "https://elitejiosaavn-api.vercel.app/api";

const FALLBACK_GENRES = [
  { id: "hindi", name: "Hindi", query: "latest Hindi songs" },
  { id: "bollywood", name: "Bollywood", query: "Bollywood hits" },
  { id: "punjabi", name: "Punjabi", query: "Punjabi hits" },
  { id: "tamil", name: "Tamil", query: "latest Tamil songs" },
  { id: "telugu", name: "Telugu", query: "latest Telugu songs" },
  { id: "malayalam", name: "Malayalam", query: "latest Malayalam songs" },
  { id: "kannada", name: "Kannada", query: "latest Kannada songs" },
  { id: "bengali", name: "Bengali", query: "latest Bengali songs" },
  { id: "marathi", name: "Marathi", query: "latest Marathi songs" },
  { id: "gujarati", name: "Gujarati", query: "latest Gujarati songs" },
  { id: "devotional", name: "Devotional", query: "Hindi devotional bhajan" },
  { id: "romantic", name: "Romantic", query: "Hindi romantic songs" },
  { id: "indie", name: "Indian Indie", query: "Indian indie songs" },
  { id: "pop", name: "Pop", query: "Hindi pop hits" },
  { id: "hiphop", name: "Hip-Hop", query: "Indian hip hop rap" },
  { id: "rock", name: "Rock", query: "Indian rock songs" },
  { id: "ghazal", name: "Ghazal", query: "Hindi ghazal" },
  { id: "classical", name: "Classical", query: "Indian classical music" },
];

function imageUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value : "";
  if (Array.isArray(value)) {
    for (const item of [...value].reverse()) {
      const url = imageUrl(item);
      if (url) return url;
    }
    return "";
  }
  return imageUrl(value.url || value.link || value.src || value.image || value.images || value.coverImage || value.coverArt);
}

function normalizeGenre(item, index, source) {
  const name = String(item?.name || item?.title || item?.label || "").trim();
  const id = String(item?.id || item?.token || item?.query || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return {
    id,
    name,
    description: item?.description || item?.subtitle || ("Discover " + name + " music on RESONATE"),
    coverImage: imageUrl(item?.image || item?.images || item?.squareImage || item?.coverImage || item?.artwork),
    color: item?.color || "#1DB954",
    order: index,
    source,
    isStatic: false,
    query: item?.query || name,
    jiosaavnUrl: item?.url || null,
  };
}

async function fetchNativeGenres() {
  const response = await fetch(JIOSAAVN_API + "/genres?page=0&limit=50", {
    headers: { Accept: "application/json", "User-Agent": "RESONATE-Catalogue/1.0" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("JioSaavn genres endpoint returned " + response.status);
  const body = await response.json();
  const results = body?.data?.results || body?.results || (Array.isArray(body?.data) ? body.data : []);
  if (!Array.isArray(results) || !results.length) throw new Error("JioSaavn returned no genre channels");
  return results
    .map((item, index) => normalizeGenre(item, index, "jiosaavn-genres"))
    .filter(item => item.name)
    .map(item => ({ ...item, coverImage: item.coverImage || "" }));
}

async function fetchFallbackGenre(genre, index) {
  try {
    const url = JIOSAAVN_API + "/search/songs?" +
      new URLSearchParams({ query: genre.query, limit: "5" }).toString();
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "RESONATE-Catalogue/1.0" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error("JioSaavn search returned " + response.status);
    const body = await response.json();
    const songs = body?.data?.results || body?.results || [];
    const best = Array.isArray(songs) ? songs.find(song => imageUrl(song?.image || song?.images || song?.album?.image)) || songs[0] : null;
    return {
      id: genre.id, name: genre.name,
      description: "Discover " + genre.name + " music on RESONATE",
      coverImage: best ? imageUrl(best.image || best.images || best.album?.image) : "",
      color: "#1DB954", order: index, source: "jiosaavn-search",
      isStatic: true, query: genre.query,
    };
  } catch {
    return {
      id: genre.id, name: genre.name,
      description: "Discover " + genre.name + " music on RESONATE",
      coverImage: "", color: "#1DB954", order: index,
      source: "jiosaavn-search-fallback", isStatic: true, query: genre.query,
    };
  }
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
  try {
    const data = await fetchNativeGenres();
    return send(res, 200, {
      success: true, data, count: data.length, source: "jiosaavn-genres", country,
      diagnostics: [{ source: "jiosaavn-genres", message: "Loaded native genre channels from JioSaavn" }],
    });
  } catch (error) {
    const data = await Promise.all(FALLBACK_GENRES.map(fetchFallbackGenre));
    return send(res, 200, {
      success: true, data, count: data.length, source: "jiosaavn-search", country,
      warning: "JioSaavn's native genre feed was unavailable; categories and cover art were recovered using JioSaavn song search.",
      diagnostics: [{ source: "jiosaavn-genres", message: error?.message || "Native genres unavailable" }],
    });
  }
}
