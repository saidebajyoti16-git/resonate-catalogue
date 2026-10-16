const CACHE_CONTROL = "public, s-maxage=1800, stale-while-revalidate=7200";

const SECTIONS = [
  { id: "new-trending", title: "New & Trending", market: "global", playlists: [
    { id: "37i9dQZEVXbMDoHDwVN2tF", label: "Top 50 Global" },
    { id: "37i9dQZF1DXcBWIGoYBM5M", label: "Today's Top Hits" },
    { id: "37i9dQZF1DX4JAvHpjipBk", label: "New Music Friday" },
  ]},
  { id: "bollywood-romance", title: "Bollywood Romance", market: "india", playlists: [
    { id: "37i9dQZF1DX0XUfTFmNBRM", label: "Bollywood Butter" },
    { id: "37i9dQZF1DXd8cOUFotp9e", label: "Punjabi Hits" },
  ]},
  { id: "chill-sad", title: "Chill & Sad", market: "global", playlists: [
    { id: "37i9dQZF1DX4WYpdgoIcn6", label: "Chill Hits" },
    { id: "37i9dQZF1DX7qK8ma5wgG1", label: "Sad Songs" },
  ]},
  { id: "popular-party", title: "Popular Party Playlists", market: "global", playlists: [
    { id: "37i9dQZF1DXaXB8fQg7xif", label: "Party Hits" },
    { id: "37i9dQZF1DX0XUsuxWHRQd", label: "RapCaviar" },
  ]},
  { id: "english-top-hits", title: "English Top Hits", market: "global", playlists: [
    { id: "37i9dQZEVXbMDoHDwVN2tF", label: "Top 50 Global" },
    { id: "37i9dQZF1DXcBWIGoYBM5M", label: "Today's Top Hits" },
  ]},
  { id: "english-trending", title: "English New & Trending", market: "global", playlists: [
    { id: "37i9dQZF1DX4JAvHpjipBk", label: "New Music Friday" },
    { id: "37i9dQZF1DX0XUsuxWHRQd", label: "RapCaviar" },
  ]},
  { id: "pop-essentials", title: "Pop Essentials", market: "global", playlists: [
    { id: "37i9dQZF1DXcBWIGoYBM5M", label: "Today's Top Hits" },
    { id: "37i9dQZF1DX4o1oenSJRJd", label: "All Out 2000s" },
  ]},
  { id: "dance-hits", title: "Dance Hits", market: "global", playlists: [
    { id: "37i9dQZF1DX4dyzvuaRJ0n", label: "mint" },
    { id: "37i9dQZF1DXaXB8fQg7xif", label: "Party Hits" },
  ]},
];

function decodeHtml(value = "") {
  return String(value).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'");
}

function meta(html, key) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = tag.match(/\bproperty=["']([^"']+)["']/i)?.[1];
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (property !== key && name !== key) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtml(content);
  }
  return "";
}

function findPlaylistEntity(node, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);
  if (Array.isArray(node.trackList) && typeof node.name === "string") return node;
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findPlaylistEntity(value, seen);
    if (found) return found;
  }
  return null;
}

function imageFrom(value) {
  if (!value) return "";
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? value : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageFrom(item);
      if (found) return found;
    }
    return "";
  }
  return imageFrom(value.url || value.href || value.src || value.image || value.images ||
    value.coverArt || value.coverImage || value.sources || value.items);
}

async function fetchOEmbed(playlistId) {
  try {
    const url = `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/playlist/${playlistId}`)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; RESONATE-Catalogue/1.0)" },
      signal: AbortSignal.timeout(3500),
      redirect: "follow",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      title: typeof data.title === "string" ? decodeHtml(data.title) : "",
      thumbnail: typeof data.thumbnail_url === "string" ? data.thumbnail_url : "",
      provider: data.provider_name || "Spotify",
    };
  } catch {
    return null;
  }
}

async function fetchPlaylistCard(playlist, origin) {
  const spotifyUrl = `https://open.spotify.com/playlist/${playlist.id}`;
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlist.id}`;
  let oembed = null;
  try {
    const response = await fetch(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RESONATE-Catalogue/1.0)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error(`Spotify returned ${response.status}`);
    const html = await response.text();
    let nextData = null;
    const dataMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\\s\\S]*?)<\\/script>/i);
    if (dataMatch?.[1]) {
      try { nextData = JSON.parse(dataMatch[1]); } catch {}
    }
    const entity = findPlaylistEntity(nextData);
    // Spotify embed HTML can omit its entity artwork on some responses. oEmbed
    // is a public, unauthenticated metadata fallback for the title and thumbnail.
    oembed = await fetchOEmbed(playlist.id);
    const image = imageFrom(entity?.image || entity?.images || entity?.coverImage || entity?.coverArt) ||
      meta(html, "og:image") || meta(html, "twitter:image") || oembed?.thumbnail || "";
    const metaTitle = meta(html, "og:title").replace(/\\s*[|–-]\\s*Spotify.*$/i, "");
    return {
      id: playlist.id,
      spotifyId: playlist.id,
      name: entity?.name || metaTitle || oembed?.title || playlist.label,
      description: entity?.description || meta(html, "og:description") || "",
      image,
      thumbnailUrl: image,
      spotifyUrl,
      embedUrl,
      source: "spotify-public-embed",
      label: playlist.label,
      metadataAvailable: Boolean(entity || metaTitle || oembed?.title),
      artworkAvailable: Boolean(image),
    };
  } catch (error) {
    oembed = oembed || await fetchOEmbed(playlist.id);
    const image = oembed?.thumbnail || "";
    return {
      id: playlist.id,
      spotifyId: playlist.id,
      name: oembed?.title || playlist.label,
      description: "",
      image,
      thumbnailUrl: image,
      spotifyUrl,
      embedUrl,
      source: oembed ? "spotify-public-oembed" : "spotify-public-link",
      label: playlist.label,
      metadataAvailable: Boolean(oembed?.title),
      artworkAvailable: Boolean(image),
      warning: image ? undefined : (error?.message || "Spotify metadata unavailable"),
    };
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ success: false, error: "Method not allowed" }); return; }

  const market = String(req.query?.market || "all").toLowerCase();
  const origin = `https://${req.headers?.host || "resonate-catalogue.vercel.app"}`;
  const selected = SECTIONS.map(section => ({
    ...section,
    playlists: section.playlists,
  })).filter(section => market !== "india" || section.market === "india" || section.market === "global")
    .map(section => ({ ...section, playlists: section.playlists }));

  const all = [...new Map(selected.flatMap(section => section.playlists).map(p => [p.id, p])).values()];
  const cards = await Promise.all(all.map(p => fetchPlaylistCard(p, origin)));
  const byId = new Map(cards.map(card => [card.spotifyId, card]));
  const data = selected.map(section => ({
    ...section,
    playlists: section.playlists.map(p => byId.get(p.id)).filter(Boolean),
  }));

  res.status(200);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify({
    success: true,
    source: "spotify-public-embed",
    market,
    data,
    count: data.reduce((sum, section) => sum + section.playlists.length, 0),
    note: "Public Spotify playlist metadata/artwork. Tracks are matched to JioSaavn for playback by RESONATE.",
  }));
}
