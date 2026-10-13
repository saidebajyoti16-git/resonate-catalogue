const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";
const ALLOWED_HOSTS = new Set(["i.scdn.co", "mosaic.scdn.co", "image-cdn-ak.spotifycdn.com"]);

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ success: false, error: message }));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res.end();
  }
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");

  let imageUrl;
  try {
    imageUrl = new URL(String(req.query?.url || ""));
  } catch {
    return sendError(res, 400, "Provide an absolute Spotify artwork URL in the url query parameter.");
  }

  if (imageUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(imageUrl.hostname.toLowerCase())) {
    return sendError(res, 400, "Only approved Spotify artwork hosts can be proxied.");
  }

  try {
    const upstream = await fetch(imageUrl.toString(), {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8", "User-Agent": "RESONATE-Catalogue/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return sendError(res, 502, "Spotify artwork host returned HTTP " + upstream.status);

    const finalUrl = new URL(upstream.url);
    if (finalUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(finalUrl.hostname.toLowerCase())) {
      return sendError(res, 502, "Artwork redirect was not to an approved Spotify image host.");
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return sendError(res, 502, "The upstream URL did not return an image.");
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
      return sendError(res, 502, "Artwork image is empty or exceeds the 8 MB limit.");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(bytes);
  } catch (error) {
    return sendError(res, 502, "Could not retrieve Spotify artwork: " + (error?.message || "upstream request failed"));
  }
}
