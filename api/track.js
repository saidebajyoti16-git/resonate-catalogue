const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

function clean(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  let overlap = 0;
  for (const word of leftWords) if (rightWords.has(word)) overlap++;
  return overlap / Math.max(leftWords.size, rightWords.size);
}

function getImage(song) {
  const candidates = song?.image || song?.images || song?.album?.image || [];
  if (Array.isArray(candidates)) {
    const best = candidates[candidates.length - 1] || candidates[0];
    return typeof best === "string" ? best : best?.url || best?.link || null;
  }
  if (typeof candidates === "string") return candidates;
  return candidates?.url || candidates?.link || null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  const title = String(req.query?.title || "").trim();
  const artists = String(req.query?.artists || "").trim();
  const id = String(req.query?.id || "").trim();
  if (!title) return sendJson(res, 400, { ok: false, error: "A track title is required." });

  const query = [title, artists].filter(Boolean).join(" ");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);

  try {
    const endpoint = "https://elitejiosaavn-api.vercel.app/api/search/songs?query=" +
      encodeURIComponent(query) + "&limit=8";
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "RESONATE-Catalogue/1.0" },
    });
    if (!response.ok) {
      return sendJson(res, 502, { ok: false, error: "Metadata provider returned an error.", providerStatus: response.status });
    }
    const body = await response.json();
    const results = body?.data?.results || body?.results || body?.data?.songs?.results || [];
    if (!Array.isArray(results) || results.length === 0) {
      return sendJson(res, 404, { ok: false, id: id || null, error: "No matching metadata was found." });
    }

    const ranked = results.map((song) => {
      const songTitle = song?.title || song?.name || "";
      const songArtists = song?.artists?.primary?.map((artist) => artist?.name).join(", ") ||
        song?.artist || song?.subtitle || "";
      const score = similarity(title, songTitle) * 0.72 + similarity(artists, songArtists) * 0.28;
      return { song, songTitle, songArtists, score };
    }).sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.48 || similarity(title, best.songTitle) < 0.55) {
      return sendJson(res, 404, { ok: false, id: id || null, error: "No confident title match was found." });
    }

    const song = best.song;
    const album = typeof song?.album === "string" ? song.album : song?.album?.name || song?.album?.title || "";
    let durationMs = Number(song?.duration_ms || song?.durationMs || song?.duration || 0);
    if (durationMs > 0 && durationMs < 10000) durationMs *= 1000;

    return sendJson(res, 200, {
      ok: true,
      id: id || null,
      source: "jiosaavn-search",
      matchScore: Number(best.score.toFixed(3)),
      track: {
        id,
        name: best.songTitle,
        artists: best.songArtists,
        album,
        duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs) : 0,
        image: getImage(song),
        providerId: song?.id || song?.perma_url || null,
      },
    });
  } catch (error) {
    return sendJson(res, 502, {
      ok: false,
      error: "Metadata lookup failed.",
      message: error?.name === "AbortError" ? "Metadata provider timed out." : (error?.message || String(error)),
    });
  } finally {
    clearTimeout(timer);
  }
}
