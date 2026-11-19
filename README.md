# ChunkScout

Static site deployed as a Cloudflare Worker with static assets (`wrangler.jsonc`). No build step.

## Structure
- `index.html`: homepage. `/#map` and `/#toolbox` redirect to the new pages.
- `seed-map/index.html`: the seed map (moved from the old homepage; supports `#goto=X,Z`).
- `tools/<tool>/index.html`: one page per tool. `tools/index.html` is the hub.
- `about/`, `contact/`, `privacy/`, `terms/`, `404.html`, `sitemap.xml`, `robots.txt`.
- `assets/site.css`, `assets/site.js`: shared styles and behavior (header, search, favorites, recent tools, footer, copy buttons, optional consent).
- `assets/data.js`: the list of pages used by search, favorites and the footer. **Add a new tool here** and to `sitemap.xml`.
- `assets/icons.svg`: pixel icon sprite.
- `assets/voxel.js`: shape engine for the sphere and shape generators (Web Worker generation, 3D preview, layer blueprints, PNG/ZIP export). Loaded only on those pages.
- `assets/blocks.js`: block colors for the gradient generator (approximate texture averages) and the map palette for the map art generator.
- `tools/building/`, `tools/survival/`, `tools/redstone/`, `tools/player/`, `tools/server/`: category pages.
- `.assetsignore`: files that are not published (README, wrangler config, the old backup HTML).

## Test locally
    npx wrangler dev        # http://localhost:8787 (closest to production, includes 404 handling)
    # or: python3 -m http.server 8000

## Deploy
Cloudflare Workers Builds deploys automatically when `main` changes (deploy command `npx wrangler deploy`).
Pushes to other branches create preview builds.

## Advertising (off by default)
All ads and sponsorships are controlled from **`assets/ads-config.js`**:
- `enabled` – master switch. `publisherId` – your `ca-pub-…` ID from AdSense.
- `slots` – one entry per placement (`homepage-banner`, `tool-top`, `tool-bottom`, `tool-sidebar`, `directory-middle`, …). Paste each AdSense ad unit's numeric ID into `unit`, or set `enabled: false` to turn one placement off.
- `pages` – which page types may show ads (home, tool, directory, guide; legal/info pages are off).
- `sponsors` – direct sponsorships, always labelled "Sponsored".
A slot with no sponsor and no configured unit stays hidden, so the site never shows empty or fake ads.
After approval, also add `ads.txt` at the repo root with the exact line AdSense gives you, and publish a consent message in AdSense > Privacy & messaging.
Placements live in the page HTML as `<div class="ad-slot" data-ad="…" data-format="…" hidden></div>`.

## Analytics (optional)
Cloudflare Web Analytics is already on (cookieless). To add Google Analytics 4, set `ga4` in `CS_CONFIG` at the top of `assets/site.js`; a consent banner then appears and GA loads only after the visitor accepts. Update `privacy/index.html` first.
