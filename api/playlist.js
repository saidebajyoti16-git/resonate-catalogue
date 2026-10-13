const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

function publicOrigin(req) {
  const proto = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "resonate-catalogue.vercel.app";
  return `${proto}://${host}`.replace(/\/$/, "");
}

function proxiedImageUrl(origin, imageUrl) {
  if (!imageUrl || !/^https?:\/\//i.test(String(imageUrl))) return null;
  return `${origin}/api/image?url=${encodeURIComponent(imageUrl)}`;
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;|&#47;/g, "/");
}

function firstImage(value) {
  if (!value) return null;
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImage(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    return firstImage(
      value.url ||
      value.href ||
      value.src ||
      value.image ||
      value.images ||
      value.coverImageUrl ||
      value.coverArt ||
      value.sources ||
      value.items
    );
  }
  return null;
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function extractNextData(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findAllByKey(node, key, out = [], seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);

  if (Object.prototype.hasOwnProperty.call(node, key)) out.push(node[key]);

  if (Array.isArray(node)) {
    for (const value of node) findAllByKey(value, key, out, seen);
  } else {
    for (const value of Object.values(node)) findAllByKey(value, key, out, seen);
  }
  return out;
}

function findPlaylistEntity(node, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node.trackList) && typeof node.name === "string") {
    return node;
  }

  if (node.data && typeof node.data === "object") {
    const nested = findPlaylistEntity(node.data, seen);
    if (nested) return nested;
  }

  if (Array.isArray(node)) {
    for (const value of node) {
      const found = findPlaylistEntity(value, seen);
      if (found) return found;
    }
  } else {
    for (const value of Object.values(node)) {
      const found = findPlaylistEntity(value, seen);
      if (found) return found;
    }
  }
  return null;
}

function findFirstTrackList(nextData) {
  const lists = findAllByKey(nextData, "trackList");
  return lists
    .filter(Array.isArray)
    .sort((a, b) => b.length - a.length)[0] || [];
}

function spotifyIdFromUri(uri) {
  const match = String(uri || "").match(/^spotify:track:([A-Za-z0-9]{22})$/);
  return match?.[1] || null;
}

function normalizeTrack(item, playlistImage = null) {
  if (!item || typeof item !== "object") return null;

  const candidates = [
    item,
    item.data,
    item.track,
    item.item,
    item.data?.track,
    item.data?.item,
  ].filter((value) => value && typeof value === "object");

  const track =
    candidates.find((value) => /^spotify:track:[A-Za-z0-9]{22}$/.test(String(value.uri || ""))) ||
    candidates.find((value) => value.name || value.title) ||
    candidates[0];

  const uri = track.uri || item.uri || item.data?.uri || item.track?.uri || null;
  const id = track.id || item.id || item.data?.id || spotifyIdFromUri(uri);
  const title =
    track.title ||
    track.name ||
    item.title ||
    item.name ||
    item.data?.title ||
    item.data?.name ||
    null;
  const artist =
    track.subtitle ||
    track.artist ||
    item.subtitle ||
    item.artist ||
    item.data?.subtitle ||
    item.data?.artist ||
    (Array.isArray(track.artists)
      ? track.artists.map((a) => a?.name || a?.profile?.name).filter(Boolean).join(", ")
      : "");

  if ((!title && !uri) || (!id && !uri)) return null;

  let durationMs = Number(
    track.duration_ms ??
    track.durationMs ??
    track.trackDurationMs ??
    item.duration_ms ??
    item.durationMs ??
    item.data?.duration_ms ??
    item.data?.durationMs ??
    0
  );
  if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
  if (durationMs > 0 && durationMs < 10000) durationMs *= 1000;

  return {
    id,
    uri,
    name: decodeHtml(String(title || `Spotify track ${String(id || uri || '').slice(-6)}`)),
    artists: decodeHtml(String(artist || "")),
    album: decodeHtml(
      String(
        track.album?.name ||
        track.album?.title ||
        track.albumOfTrack?.name ||
        item.album?.name ||
        item.album ||
        item.data?.album?.name ||
        item.data?.album ||
        ""
      )
    ),
    image:
      firstImage(
        track.image ||
        track.images ||
        track.coverArt ||
        track.albumOfTrack?.coverArt ||
        track.visuals?.coverArt ||
        item.image ||
        item.images ||
        item.coverArt ||
        item.data?.image ||
        item.data?.images ||
        item.data?.coverArt
      ) || playlistImage,
    imageProxy: null,
    duration_ms: Math.round(durationMs),
    explicit: Boolean(
      track.isExplicit ??
      track.explicit ??
      item.isExplicit ??
      item.explicit ??
      item.data?.isExplicit ??
      false
    ),
  };
}

function extractTracksFromHtml(nextData, html, playlistImage = null) {
  const tracks = [];
  const seen = new Set();
  const add = (track) => {
    const normalized = normalizeTrack(track, playlistImage);
    if (!normalized) return;
    const key = normalized.uri || normalized.id || `${normalized.name}::${normalized.artists}`;
    if (seen.has(key)) return;
    seen.add(key);
    tracks.push(normalized);
  };

  // Prefer rich embedded track entities so title, artist, album, artwork and
  // duration are retained. URI-only matches are a last-resort fallback.
  const stack = [nextData];
  const visited = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }

    const uri = value.uri || value.trackUri || value.track_uri;
    const hasSpotifyTrackUri = /^spotify:track:[A-Za-z0-9]{22}$/.test(String(uri || ""));
    const hasTrackMetadata = Boolean(
      value.name || value.title || value.artists || value.subtitle ||
      value.album || value.albumOfTrack || value.duration_ms || value.durationMs
    );
    if (hasSpotifyTrackUri && hasTrackMetadata) add(value);

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }

  if (tracks.length) return tracks;

  const uriMatches = new Set();
  for (const match of String(html || "").matchAll(/spotify:track:([A-Za-z0-9]{22})/g)) {
    uriMatches.add(match[1]);
  }
  for (const id of uriMatches) {
    add({ uri: `spotify:track:${id}`, title: `Spotify track ${id.slice(-6)}` });
  }
  return tracks;
}

function extractPlaylist(nextData, html, id, origin) {
  const entity = findPlaylistEntity(nextData);
  const trackList = entity?.trackList?.length ? entity.trackList : findFirstTrackList(nextData);

  const playlistImage =
    firstImage(entity?.image || entity?.images || entity?.coverImage || entity?.coverArt) ||
    extractMeta(html, "og:image") ||
    extractMeta(html, "twitter:image");

  const title =
    entity?.name ||
    extractMeta(html, "og:title") ||
    `Spotify Playlist ${id}`;

  const description =
    entity?.description ||
    extractMeta(html, "og:description") ||
    "";

  const owner = entity?.subtitle || entity?.owner?.name || entity?.owner?.display_name || null;

  // Spotify's embed can contain a compact playlist trackList alongside richer
  // track entities elsewhere in __NEXT_DATA__. Merge both sources by Spotify URI
  // so compact entries do not hide album, duration, and track-specific artwork.
  const compactTracks = trackList
    .map((item) => normalizeTrack(item, playlistImage))
    .filter(Boolean);
  const richTracks = extractTracksFromHtml(nextData, html, playlistImage);
  const tracksByKey = new Map();

  for (const track of [...compactTracks, ...richTracks]) {
    const key = track.uri || track.id || (track.name + '::' + track.artists);
    if (!key) continue;
    const previous = tracksByKey.get(key);
    if (!previous) {
      tracksByKey.set(key, track);
      continue;
    }

    tracksByKey.set(key, {
      ...previous,
      ...track,
      name: track.name && !/^Spotify track /.test(track.name) ? track.name : previous.name,
      artists: track.artists || previous.artists,
      album: track.album || previous.album,
      image: (track.image && track.image !== playlistImage) ? track.image : (previous.image || track.image),
      duration_ms: track.duration_ms > 0 ? track.duration_ms : previous.duration_ms,
      explicit: track.explicit || previous.explicit,
    });
  }

  const uniqueTracks = [...tracksByKey.values()];
  // Keep this endpoint fast and stable while metadata enrichment is debugged.
  // Enrichment will be moved to a separate endpoint after the base catalogue is verified.
  const enrichedTracks = uniqueTracks;

  const playlistImageProxy = proxiedImageUrl(origin, playlistImage);
  const proxiedTracks = enrichedTracks.map((track) => ({
    ...track,
    imageProxy: proxiedImageUrl(origin, track.image || playlistImage),
  }));

  return {
    id,
    uri: `spotify:playlist:${id}`,
    name: decodeHtml(String(title || `Spotify Playlist ${id}`)),
    description: decodeHtml(String(description)),
    image: playlistImage,
    imageProxy: playlistImageProxy,
    owner: owner ? decodeHtml(String(owner)) : null,
    tracks: proxiedTracks,
    trackCount: proxiedTracks.length,
    truncated: proxiedTracks.length >= 100,
  };
}

async function fetchSpotifyEmbed(id) {
  const url = `https://open.spotify.com/embed/playlist/${encodeURIComponent(id)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const html = await response.text();
    return { response, html, url };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const id = String(req.query?.id || "").trim();
  if (!/^[A-Za-z0-9]{22}$/.test(id)) {
    sendJson(res, 400, { ok: false, error: "A valid 22-character Spotify playlist ID is required." });
    return;
  }

  try {
    const { response, html, url } = await fetchSpotifyEmbed(id);

    if (!response.ok) {
      sendJson(res, 502, {
        ok: false,
        error: "Spotify embed request failed.",
        spotifyStatus: response.status,
        spotifyUrl: url,
      });
      return;
    }

    const nextData = extractNextData(html);
    if (!nextData) {
      sendJson(res, 502, {
        ok: false,
        error: "Spotify responded, but the public embed data block could not be parsed.",
        htmlLength: html.length,
      });
      return;
    }

    const playlist = extractPlaylist(nextData, html, id, publicOrigin(req));

    sendJson(res, 200, {
      ok: true,
      source: "spotify-public-embed",
      playlist,
      diagnostics: {
        htmlLength: html.length,
        hasNextData: true,
        extractedTracks: playlist.trackCount,
        hasArtwork: Boolean(playlist.image),
        hasTrackUrisInHtml: /spotify:track:[A-Za-z0-9]{22}/.test(html),
        trackUriCountInHtml: (html.match(/spotify:track:[A-Za-z0-9]{22}/g) || []).length,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: "Vercel could not fetch Spotify.",
      message: error?.message || String(error),
    });
  }
}
