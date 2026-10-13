const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const GENRES = [
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

function getImage(song) {
  const candidates = song?.image || song?.images || song?.album?.image || [];
  if (Array.isArray(candidates)) {
    const ranked = [...candidates].reverse();
    for (const image of ranked) {
      const url = typeof image === "string" ? image : image?.url || image?.link;
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  }
  if (typeof candidates === "string" && /^https?:\/\//i.test(candidates)) return candidates;
  return candidates?.url || candidates?.link || "";
}

async function fetchGenre(genre, index, country) {
  try {
    const url = "https://elitejiosaavn-api.vercel.app/api/search/songs?" +
      new URLSearchParams({ query: genre.query, limit: "5" }).toString();
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "RESONATE-Catalogue/1.0" },
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error("JioSaavn search returned " + response.status);
    const body = await response.json();
    const songs = body?.data?.results || body?.results || body?.data?.songs?.results || [];
    const best = Array.isArray(songs) ? songs.find(song => getImage(song)) || songs[0] : null;
    return {
      id: genre.id,
      name: genre.name,
      description: "Discover " + genre.name + " music on RESONATE",
      coverImage: best ? getImage(best) : "",
      color: "#1DB954",
      order: index,
      source: "jiosaavn-search",
      isStatic: true,
      query: genre.query,
      sampleSong: best ? {
        id: best.id || best.songId || null,
        name: best.title || best.name || "",
        artists: best?.artists?.primary?.map(a => a.name).join(", ") || best.artist || best.subtitle || "",
      } : null,
    };
  } catch (error) {
    return {
      id: genre.id, name: genre.name,
      description: "Discover " + genre.name + " music on RESONATE",
      coverImage: "", color: "#1DB954", order: index,
      source: "jiosaavn-search-fallback", isStatic: true,
      query: genre.query, warning: error?.message || "JioSaavn lookup failed",
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
  const data = await Promise.all(GENRES.map((genre, index) => fetchGenre(genre, index, country)));
  const withArtwork = data.filter(genre => genre.coverImage).length;
  return send(res, 200, {
    success: true, data, count: data.length, source: "jiosaavn-search", country,
    diagnostics: [{ source: "jiosaavn-search", message: withArtwork + "/" + data.length + " genres have JioSaavn artwork" }],
  });
}
