// Builds erinchristopoulos.com into ./dist.
// No dependencies: needs Node 20 or newer (built-in fetch).
//
// Pulls, on every build:
//   - the newest essays (and their covers) from the A Little Less RSS feed
//   - the newest Reels and posts from Instagram, when IG_ACCESS_TOKEN is set
// Everything else (ShopMy collections, photos) comes from ./data and ./static.
//
// Local test without network:  FEED_FILE=test/feed.xml COVERS_DIR=test/covers node build.mjs

import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
const run = promisify(execFile);

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const cfg = JSON.parse(await readFile(path.join(root, 'data/config.json'), 'utf8'));
const collections = JSON.parse(await readFile(path.join(root, 'data/collections.json'), 'utf8'));
const igFallback = JSON.parse(await readFile(path.join(root, 'data/instagram-fallback.json'), 'utf8'));

const AR = '<svg class="ar" aria-hidden="true" viewBox="0 0 16 12"><path d="M0 6h14M9 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .trim();

async function fetchWithRetry(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'user-agent': 'erinchristopoulos.com site builder', ...(opts.headers || {}) } });
      if (r.ok) return r;
      last = new Error(`${r.status} ${r.statusText} for ${url.split('?')[0]}`);
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw last;
}

// Saves a remote image into dist/img and returns its path on the site.
// If the download fails, the page links the remote image directly so nothing breaks.
async function saveImage(url, name) {
  try {
    const r = await fetchWithRetry(url);
    const type = r.headers.get('content-type') || '';
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const file = `img/${name}.${ext}`;
    await writeFile(path.join(dist, file), Buffer.from(await r.arrayBuffer()));
    return file;
  } catch (e) {
    console.warn(`  could not save ${name}: ${e.message}`);
    return url;
  }
}

// ---------- essays (RSS) ----------
async function getEssays() {
  const xml = process.env.FEED_FILE
    ? await readFile(path.join(root, process.env.FEED_FILE), 'utf8')
    : await (await fetchWithRetry(cfg.substackFeed)).text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const it = m[1];
    const tag = (t) => decode((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
    const enclosure = (it.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1];
    return { title: tag('title'), link: tag('link'), date: new Date(tag('pubDate')), cover: enclosure ? decode(enclosure) : null };
  }).filter((e) => e.title && e.link);
  const essays = items.slice(0, cfg.essays);
  for (const [i, e] of essays.entries()) {
    if (!e.cover) continue;
    const id = path.basename(e.cover).slice(0, 8);
    if (process.env.COVERS_DIR && existsSync(path.join(root, process.env.COVERS_DIR, `${id}.jpg`))) {
      await cp(path.join(root, process.env.COVERS_DIR, `${id}.jpg`), path.join(dist, `img/essay-${i + 1}.jpg`));
      e.image = `img/essay-${i + 1}.jpg`;
    } else {
      const sized = `https://substackcdn.com/image/fetch/w_960,c_limit,f_jpg,q_auto:good,fl_progressive:steep/${encodeURIComponent(e.cover)}`;
      e.image = await saveImage(sized, `essay-${i + 1}`);
    }
  }
  return essays;
}

// ---------- Instagram ----------
// Downloads a Reel and cuts a short, silent preview: 6 seconds, 480px wide, H.264.
// Returns the local path, or null when the video can't be fetched or ffmpeg isn't there.
async function saveVideo(url, name) {
  const tmp = path.join(os.tmpdir(), `${name}-src.mp4`);
  try {
    const r = await fetchWithRetry(url);
    await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-t', '6', '-i', tmp, '-an',
      '-vf', 'scale=480:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dist, `img/${name}.mp4`)]);
    return `img/${name}.mp4`;
  } catch (e) {
    console.warn(`  no preview for ${name} (${e.message.split('\n')[0]})`);
    return null;
  } finally {
    await rm(tmp, { force: true });
  }
}

// Instagram is read through graph.facebook.com with a token that never expires
// (a Unified-login token, or a system-user token from the business portfolio).
async function fetchMedia(token) {
  const fields = 'id,media_type,permalink,thumbnail_url,media_url,timestamp,children{media_type,media_url,thumbnail_url}';
  const t = encodeURIComponent(token);
  const fb = process.env.IG_API_BASE || 'https://graph.facebook.com/v26.0';
  // Unified-login tokens can list the account; Page and system-user tokens use the saved ID.
  let id = cfg.igUserId;
  try {
    const a = await fetch(`${fb}/me/assigned_instagram_accounts?fields=id,username&access_token=${t}`);
    const { data: accounts = [] } = await a.json();
    id = (accounts.find((x) => x.username === cfg.igUsername) || accounts[0] || {}).id || id;
  } catch { /* keep the saved ID */ }
  const r = await fetchWithRetry(`${fb}/${id}/media?fields=${encodeURIComponent(fields)}&limit=40&access_token=${t}`);
  const all = (await r.json()).data || [];
  return onlyWhatsOnTheGrid(fb, id, t, all);
}


// /media also returns trial Reels, which never appear on the profile. Business Discovery returns
// what the public profile shows, so anything missing from it stays off the site. It needs a token
// with pages_read_engagement and instagram_manage_insights; without one, nothing is filtered.
async function onlyWhatsOnTheGrid(fb, id, t, all) {
  try {
    const me = await (await fetch(`${fb}/me?fields=name&access_token=${t}`)).json();
    const perms = await (await fetch(`${fb}/me/permissions?access_token=${t}`)).json();
    const granted = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission).join(', ');
    console.log(`  token belongs to: ${me.name || me.error?.message}; permissions: ${granted || perms.error?.message || 'none listed'}`);
    const own = await (await fetch(`${fb}/${id}?fields=media_count&access_token=${t}`)).json();
    const pub = await (await fetch(`${fb}/${id}?fields=${encodeURIComponent(`business_discovery.username(${cfg.igUsername}){media_count}`)}&access_token=${t}`)).json();
    console.log(`  post count: account says ${own.media_count ?? own.error?.message}, public profile says ${pub.business_discovery?.media_count ?? pub.error?.message}`);
    // Diagnostic only: does each recent Reel reach followers, or non-followers only (a trial)?
    for (const m of all.filter((x) => x.media_type === 'VIDEO').slice(0, 10)) {
      const ins = await (await fetch(`${fb}/${m.id}/insights?metric=reach&breakdown=follow_type&access_token=${t}`)).json();
      if (ins.error) { console.log(`    reel ${m.timestamp.slice(0, 10)}: ${ins.error.message}`); continue; }
      const rows = ins.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      const followers = rows.find((r) => /^FOLLOWER$/i.test(r.dimension_values?.[0]))?.value || 0;
      console.log(`    reel ${m.timestamp.slice(0, 10)}: ${rows.length ? (followers > 0 ? 'reached followers' : 'non-followers only') : 'no breakdown returned'}`);
    }
  } catch (e) { console.log(`  diagnostics stopped: ${e.message}`); }
  try {
    const q = `business_discovery.username(${cfg.igUsername}){media.limit(60){id}}`;
    const r = await fetch(`${fb}/${id}?fields=${encodeURIComponent(q)}&access_token=${t}`);
    const body = await r.json();
    if (!r.ok) throw new Error(body?.error?.message || `HTTP ${r.status}`);
    const onGrid = new Set((body.business_discovery?.media?.data || []).map((m) => m.id));
    if (!onGrid.size) throw new Error('the profile returned no posts');
    const shown = all.filter((m) => onGrid.has(m.id));
    console.log(`  ${shown.length} of ${all.length} posts are on the grid; left off ${all.length - shown.length} trial Reels or hidden posts`);
    return shown;
  } catch (e) {
    console.log(`  grid check unavailable (${e.message}); showing every post, trial Reels included`);
    return all;
  }
}

async function getInstagram() {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) {
    console.log('  no IG_ACCESS_TOKEN: using the saved Reels and posts');
    return igFallback;
  }
  try {
    const data = await fetchMedia(token);
    const reelsSrc = data.filter((m) => m.media_type === 'VIDEO' && m.thumbnail_url).slice(0, cfg.reels);
    // The grid mirrors the Instagram grid: newest posts of every kind, each shown by its cover image.
    const cover = (m) => (m.media_type === 'VIDEO' ? m.thumbnail_url
      : m.media_url || m.children?.data?.map((c) => (c.media_type === 'VIDEO' ? c.thumbnail_url : c.media_url)).find(Boolean));
    const gridSrc = data.filter((m) => cover(m)).slice(0, cfg.grid);
    const withVideo = reelsSrc.filter((m) => m.media_url).length;
    console.log(`  ${data.length} posts from Instagram; ${withVideo} of ${reelsSrc.length} Reels have a video file (the rest use licensed audio)`);
    const fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const reels = [];
    for (const [i, m] of reelsSrc.entries()) {
      reels.push({
        image: await saveImage(m.thumbnail_url, `reel-${i + 1}`),
        // media_url is missing for Reels with licensed audio; those keep the cover only.
        video: m.media_url ? await saveVideo(m.media_url, `reel-${i + 1}`) : null,
        url: m.permalink,
        alt: `Reel from ${fmt(m.timestamp)}`,
      });
    }
    const grid = [];
    for (const [i, m] of gridSrc.entries()) {
      grid.push({ image: await saveImage(cover(m), `post-${i + 1}`), url: m.permalink, alt: `Instagram post from ${fmt(m.timestamp)}` });
    }
    if (!reels.length && !grid.length) throw new Error('Instagram returned no media');
    return { reels: reels.length ? reels : igFallback.reels, grid: grid.length ? grid : igFallback.grid };
  } catch (e) {
    console.warn(`  Instagram failed (${e.message}): using the saved Reels and posts`);
    return igFallback;
  }
}

// ---------- ShopMy ----------
async function getCollections() {
  const out = [];
  for (const [ci, c] of collections.entries()) {
    const images = [];
    for (const [ii, url] of c.images.entries()) {
      const local = process.env.SHOP_DIR && path.join(root, process.env.SHOP_DIR, `shop-${ci + 1}-${ii + 1}.jpg`);
      if (local && existsSync(local)) {
        await cp(local, path.join(dist, `img/shop-${ci + 1}-${ii + 1}.jpg`));
        images.push(`img/shop-${ci + 1}-${ii + 1}.jpg`);
      } else {
        images.push(await saveImage(url, `shop-${ci + 1}-${ii + 1}`));
      }
    }
    out.push({ ...c, images });
  }
  return out;
}

// ---------- render ----------
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'img'), { recursive: true });
await cp(path.join(root, 'static'), dist, { recursive: true });

console.log('essays…');
const essays = await getEssays();
console.log('instagram…');
const ig = await getInstagram();
console.log('shop…');
const shop = await getCollections();

const essaysHtml = essays.map((e) => `    <a class="essay" href="${esc(e.link)}"><img src="${esc(e.image || '')}" alt="${esc(e.title)}" loading="lazy" width="960" height="691"></a>`).join('\n');
const reelsHtml = ig.reels.map((r) => r.video
  ? `    <a class="reel" href="${esc(r.url)}"><video muted playsinline loop preload="none" poster="${esc(r.image)}" src="${esc(r.video)}" aria-label="${esc(r.alt || 'Reel')}"></video></a>`
  : `    <a class="reel" href="${esc(r.url)}"><img src="${esc(r.image)}" alt="${esc(r.alt || 'Reel')}" loading="lazy"></a>`).join('\n');
const gridHtml = ig.grid.map((g) => `    <a href="${esc(g.url)}"><img src="${esc(g.image)}" alt="${esc(g.alt || 'Instagram post')}" loading="lazy"></a>`).join('\n');
const shopHtml = shop.map((c) => `    <a class="coll" href="${esc(c.url)}">
      <div class="grid">${c.images.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join('')}</div>
      <div class="rule"></div>
      <div class="nm">${esc(c.name)}</div>
      <div class="lab">${esc(c.count)}</div>
    </a>`).join('\n');

const tpl = await readFile(path.join(root, 'src/template.html'), 'utf8');
const html = tpl
  .replaceAll('{{ESSAYS}}', essaysHtml)
  .replaceAll('{{REELS}}', reelsHtml)
  .replaceAll('{{COLLECTIONS}}', shopHtml)
  .replaceAll('{{GRID}}', gridHtml)
  .replaceAll('{{AR}}', AR)
  .replaceAll('{{DOMAIN}}', cfg.domain)
  .replaceAll('{{ARCHIVE}}', esc(cfg.substackArchive))
  .replaceAll('{{SUBSCRIBE}}', esc(cfg.substackSubscribe))
  .replaceAll('{{INSTAGRAM}}', esc(cfg.instagramProfile))
  .replaceAll('{{SHOP}}', esc(cfg.shopmyShop))
  .replaceAll('{{EMAIL}}', esc(cfg.email))
  .replaceAll('{{YEAR}}', String(new Date().getFullYear()))
  .replaceAll('{{BUILT}}', new Date().toISOString());

await writeFile(path.join(dist, 'index.html'), html);
await writeFile(path.join(dist, 'CNAME'), cfg.domain + '\n');
await writeFile(path.join(dist, '.nojekyll'), '');
console.log(`done: ${essays.length} essays, ${ig.reels.length} reels, ${ig.grid.length} posts, ${shop.length} collections`);
