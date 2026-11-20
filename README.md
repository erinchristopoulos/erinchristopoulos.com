# erinchristopoulos.com

Erin's link page, built in her brand kit (Archivo on soft white, slate, butter and vermilion).

## What updates by itself

The site rebuilds every morning and whenever this repository changes.

- The newest A Little Less essays and their covers come from the Substack feed.
- The newest Reels and posts come from Instagram once `IG_ACCESS_TOKEN` is saved as a repository secret. Until then, the saved Reels in `data/instagram-fallback.json` show.
- The token comes from the Meta app's "API setup with Unified login" (a system-user token that doesn't expire). The build looks up the Instagram account with `/me/assigned_instagram_accounts` on graph.facebook.com, then reads its media.

## What to edit by hand

- `data/collections.json` holds the four ShopMy collections on the page.
- `data/config.json` holds the links, the email address and how many essays, Reels and posts to show.
- `static/img/portrait.jpg` is the top photo.

## The partnerships page

`static/partnerships/` is the brand-facing media kit at www.erinchristopoulos.com/partnerships. The build copies it to the site as it is, so it doesn't change on its own.

- The numbers come from the CSV files in `static/partnerships/data`. To update them, replace a file with new numbers and keep the same column names.
- The photos, logos and short silent Reel loops are in `static/partnerships/media`.
- The words are in `static/partnerships/index.html`, the styles in `ec.css` and the charts in `app.js`. `dash-static.js` loads the CSV files and draws the charts.

## Hosting

GitHub Pages serves the `dist` folder that `build.mjs` makes, at www.erinchristopoulos.com (the plain erinchristopoulos.com redirects there). Email for the domain runs on Google Workspace, so its MX records stay as they are when the website records change.

## Build it locally

`node build.mjs` (Node 20 or newer, no installs). Without network: `FEED_FILE=test/feed.xml COVERS_DIR=test/covers SHOP_DIR=test/shop node build.mjs`.
