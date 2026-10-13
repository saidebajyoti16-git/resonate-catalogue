# resonate-catalogue

Server-side Spotify public/embed metadata proxy for Jammify/Resonate.

## Endpoints

- `GET /api/health`
- `GET /api/playlist?id=SPOTIFY_PLAYLIST_ID`
- `GET /api/image?url=SPOTIFY_CDN_IMAGE_URL`

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


### Image proxy

The playlist endpoint now also returns `imageProxy` URLs. These are served by `/api/image` so browsers that cannot directly reach Spotify CDN hosts can still display Spotify artwork through this Vercel deployment. The image proxy only accepts Spotify CDN hostnames.


## Jammify integration

For Jammify, use `SPOTIFY_CATALOGUE_API_URL=https://resonate-catalogue.vercel.app`.
The `/api/playlist` response includes `image` and `imageProxy`; Jammify should prefer `imageProxy` for Spotify CDN artwork.


## Live Spotify genres and browse categories

- `GET /api/genres?country=IN` returns Spotify Browse categories when available.
- Source order: authenticated Spotify Web API, Spotify's public browse page, then a clearly labelled static fallback.
- The JSON response includes `source` (`spotify-web-api`, `spotify-public-browse`, or `static-fallback`) and category-level `source` values.
- The endpoint caches results at the CDN for 15 minutes.

### Optional Spotify API credentials

Add these Environment Variables to the Vercel project to enable the official API attempt:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Create/manage these credentials in the Spotify Developer Dashboard. Keep both variables server-side; do not prefix them with `NEXT_PUBLIC_`.

The Spotify Web API's available endpoints and access rules can change by app/account. If the official endpoint is unavailable, the fetcher tries the public browse page and labels any static fallback explicitly.

Test after deployment:

`https://resonate-catalogue.vercel.app/api/genres?country=IN`
