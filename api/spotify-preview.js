const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.com", "www.spotify.com"]);

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

function safeText(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function meta(html, property) {
  const tags = html.match(/<meta\\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    const attrPattern = /([^\\s=]+)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))/g;
    let match;
    while ((match = attrPattern.exec(tag))) {
      attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
    }
    if ((attrs.property || attrs.name || "").toLowerCase() === property.toLowerCase() && attrs.content) {
      return safeText(attrs.content);
    }
  }
  return "";
}

function normalizeSpotifyUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    // Accept a Spotify URI or a bare playlist/album/track URL path.
    const cleaned = String(input || "").trim().replace(/^spotify:/i, "https://open.spotify.com/");
    try { url = new URL(cleaned); } catch { return null; }
  }
  if (!SPOTIFY_HOSTS.has(url.hostname.toLowerCase())) return null;
  url.hostname = "open.spotify.com";
  url.protocol = "https:";
  url.search = "";
  url.hash = "";
  return url;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET") return send(res, 405, { success: false, error: "Method not allowed" });

  const input = String(req.query?.url || req.query?.uri || "").trim();
  if (!input) return send(res, 400, {
    success: false,
    error: "Provide a public Spotify URL using ?url=https://open.spotify.com/playlist/...",
    example: "/api/spotify-preview?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F37i9dQZF1DXcBWIGoYBM5M",
  });

  const spotifyUrl = normalizeSpotifyUrl(input);
  if (!spotifyUrl || !/\/(playlist|album|track|artist|show|episode)\//i.test(spotifyUrl.pathname)) {
    return send(res, 400, { success: false, error: "Use a valid public Spotify playlist, album, track, artist, show, or episode URL." });
  }

  const kind = spotifyUrl.pathname.split("/").filter(Boolean)[0];
  const diagnostics = [];

  // Try Spotify's public oEmbed response first; it may expose a thumbnail for supported links.
  try {
    const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent(spotifyUrl.toString());
    const response = await fetch(oembedUrl, {
      headers: { Accept: "application/json", "User-Agent": "RESONATE-Catalogue/1.0 (+public metadata preview)" },
      signal: AbortSignal.timeout(4500),
    });
    if (response.ok) {
      const body = await response.json();
      if (body?.thumbnail_url) {
        return send(res, 200, {
          success: true, source: "spotify-oembed", type: kind,
          title: body.title || "", thumbnail: body.thumbnail_url,
          spotifyUrl: spotifyUrl.toString(), embedUrl: "https://open.spotify.com/embed" + spotifyUrl.pathname,
          width: body.width || null, height: body.height || null,
          attribution: "Spotify", diagnostics,
        });
      }
      diagnostics.push({ source: "spotify-oembed", message: "No thumbnail in oEmbed response" });
    } else {
      diagnostics.push({ source: "spotify-oembed", message: "oEmbed returned HTTP " + response.status });
    }
  } catch (error) {
    diagnostics.push({ source: "spotify-oembed", message: error?.message || "oEmbed request failed" });
  }

  // Fallback: read public page metadata only; do not extract tracks or audio streams.
  try {
    const response = await fetch(spotifyUrl.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; RESONATE-Catalogue/1.0; +https://resonate.codeex.space)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw new Error("Spotify page returned HTTP " + response.status);
    const html = await response.text();
    const title = meta(html, "og:title") || meta(html, "twitter:title");
    const thumbnail = meta(html, "og:image") || meta(html, "twitter:image");
    const description = meta(html, "og:description") || meta(html, "description");
    if (!thumbnail && !title) throw new Error("Spotify page did not expose public title or artwork metadata");
    return send(res, 200, {
      success: true, source: "spotify-public-page", type: kind,
      title, description, thumbnail,
      spotifyUrl: spotifyUrl.toString(), embedUrl: "https://open.spotify.com/embed" + spotifyUrl.pathname,
      attribution: "Spotify", diagnostics,
    });
  } catch (error) {
    diagnostics.push({ source: "spotify-public-page", message: error?.message || "Public page metadata unavailable" });
  }

  return send(res, 502, {
    success: false,
    error: "Spotify did not return public artwork metadata for this link. The link may be private, unavailable, or blocked by upstream access rules.",
    spotifyUrl: spotifyUrl.toString(),
    embedUrl: "https://open.spotify.com/embed" + spotifyUrl.pathname,
    diagnostics,
  });
}
