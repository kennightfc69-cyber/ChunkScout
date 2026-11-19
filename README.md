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
- `.assetsignore`: files that are not published (README, wrangler config, the old backup HTML).

## Test locally
    npx wrangler dev        # http://localhost:8787 (closest to production, includes 404 handling)
    # or: python3 -m http.server 8000

## Deploy
Cloudflare Workers Builds deploys automatically when `main` changes (deploy command `npx wrangler deploy`).
Pushes to other branches create preview builds.

## Analytics / ads (optional, later)
Edit `CS_CONFIG` at the top of `assets/site.js`. Setting `ga4` or `adsense` turns on a consent banner and loads the script only after the visitor accepts.
Update `privacy/index.html` before enabling either one.
