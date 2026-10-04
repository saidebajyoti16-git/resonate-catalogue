# resonate-catalogue

Server-side Spotify public/embed metadata proxy for Jammify/Resonate.

## Endpoints

- `GET /api/health`
- `GET /api/playlist?id=SPOTIFY_PLAYLIST_ID`

## Deploy

Import this folder/repository into Vercel. No Spotify API key is required for the public embed fetch.

## Rename from jammify-spotify-proxy

If this replaces an existing Vercel project:

1. Rename the GitHub repository from `jammify-spotify-proxy` to `resonate-catalogue` (optional but recommended).
2. In Vercel, rename the Project to `resonate-catalogue`.
3. Vercel will provide a new URL such as `https://resonate-catalogue.vercel.app` if available.
4. In Jammify `.env.local`, update `SPOTIFY_SCRAPER_API_URL` to the new Vercel origin, without a trailing slash.
5. If your Jammify code has a hard-coded `jammify-spotify-proxy.vercel.app`, replace it with the new origin.
6. Any `NEXT_PUBLIC_*` value should be updated and the local Next.js server restarted.

## Test

`https://resonate-catalogue.vercel.app/api/health`

`https://resonate-catalogue.vercel.app/api/playlist?id=37i9dQZF1DXcBWIGoYBM5M`
