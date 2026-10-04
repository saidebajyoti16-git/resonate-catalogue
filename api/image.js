const CACHE_CONTROL = "public, s-maxage=604800, stale-while-revalidate=2592000";

function allowedSpotifyImageHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host === 'i.scdn.co' ||
    host.endsWith('.scdn.co') ||
    host.endsWith('.spotifycdn.com') ||
    host.endsWith('.spotifycdn.net')
  );
}

function sendError(res, status, error) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({ ok: false, error }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  const rawUrl = String(req.query?.url || '').trim();
  if (!rawUrl) {
    sendError(res, 400, 'url is required');
    return;
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    sendError(res, 400, 'Invalid URL');
    return;
  }

  if (!['http:', 'https:'].includes(target.protocol) || !allowedSpotifyImageHost(target.hostname)) {
    sendError(res, 403, 'Only Spotify CDN image hosts are allowed');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      sendError(res, 502, `Spotify image fetch failed (${upstream.status})`);
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) {
      sendError(res, 502, 'Spotify CDN did not return an image');
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(200);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', CACHE_CONTROL);
    res.setHeader('CDN-Cache-Control', 'max-age=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(body);
  } catch (error) {
    sendError(res, error?.name === 'AbortError' ? 504 : 502, error?.name === 'AbortError' ? 'Spotify image fetch timed out' : 'Failed to fetch Spotify image');
  } finally {
    clearTimeout(timeout);
  }
}
