# erinchristopoulos.com

Erin's link page, built in her brand kit (Archivo on soft white, slate, butter and vermilion).

## What updates by itself

The site rebuilds every morning and whenever this repository changes.

- The newest A Little Less essays and their covers come from the Substack feed.
- The newest Reels and posts come from Instagram once `IG_ACCESS_TOKEN` is saved as a repository secret. Until then, the saved Reels in `data/instagram-fallback.json` show.
- The Instagram token renews itself every two weeks once `SECRETS_WRITER` is saved too (see `.github/workflows/refresh-instagram-token.yml`).

## What to edit by hand

- `data/collections.json` holds the four ShopMy collections on the page.
- `data/config.json` holds the links, the email address and how many essays, Reels and posts to show.
- `static/img/portrait.jpg` is the top photo.

## Hosting

GitHub Pages serves the `dist` folder that `build.mjs` makes, at www.erinchristopoulos.com (the plain erinchristopoulos.com redirects there). Email for the domain runs on Google Workspace, so its MX records stay as they are when the website records change.

## Build it locally

`node build.mjs` (Node 20 or newer, no installs). Without network: `FEED_FILE=test/feed.xml COVERS_DIR=test/covers SHOP_DIR=test/shop node build.mjs`.
