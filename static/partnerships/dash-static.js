// A small stand-in for the dashboard runtime the partnerships page was first built in.
// It loads the CSV files in ./data, works out the derived figures (dash.calc),
// and runs the drawing functions in app.js (dash.draw) on every element that asks for them.
// To update the numbers, replace a CSV file in ./data with the same column names.
window.dash = (function () {
  const files = {
    ig_account: 'data/ig-account.csv',
    ig_age: 'data/ig-age.csv',
    ig_countries: 'data/ig-countries.csv',
    ig_reels: 'data/ig-reels.csv',
    brand_work: 'data/brand-posts.csv',
    sub_summary: 'data/substack-summary.csv',
    sub_essays: 'data/substack-essays.csv',
    sub_overlap: 'data/substack-overlap.csv'
  };
  const store = {};
  const calcs = {};
  const draws = {};
  const widths = new WeakMap();
  let started = false;

  const run = (name, el) => {
    const fn = draws[name];
    if (!fn) return;
    try { fn(el); } catch (e) { console.error('[partnerships] ' + name, e); }
  };
  const runAll = (name) => document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => run(name, el));

  function computeCalcs() {
    let progress = true;
    while (progress) {
      progress = false;
      for (const [name, spec] of Object.entries(calcs)) {
        if (store[name]) continue;
        const inputs = spec.inputs.map((i) => store[i]);
        if (inputs.some((d) => !d || d.status === 'loading')) continue;
        if (inputs.some((d) => d.status === 'error')) { store[name] = { status: 'error' }; progress = true; continue; }
        try { store[name] = { status: 'ok', data: spec.fn(...inputs.map((d) => d.data)) }; }
        catch (e) { console.error('[partnerships] calc ' + name, e); store[name] = { status: 'error' }; }
        progress = true;
      }
    }
  }

  return {
    calc(name, spec) { calcs[name] = spec; },
    data(name) { return store[name] || { status: 'loading' }; },
    draw(name, fn) {
      if (fn) { draws[name] = fn; if (started) runAll(name); return; }
      runAll(name);
    },
    async start() {
      started = true;
      Object.keys(draws).forEach(runAll);
      await Promise.all(Object.entries(files).map(async ([name, url]) => {
        try {
          const r = await fetch(url, { cache: 'no-cache' });
          if (!r.ok) throw new Error(r.status + ' for ' + url);
          store[name] = { status: 'ok', data: d3.csvParse(await r.text()) };
        } catch (e) {
          console.error('[partnerships] ' + name, e);
          store[name] = { status: 'error' };
        }
      }));
      computeCalcs();
      Object.keys(draws).forEach(runAll);
      // Charts are drawn to the width they have, so draw them again when that width changes.
      if ('ResizeObserver' in window) {
        const ro = new ResizeObserver((entries) => entries.forEach((en) => {
          const el = en.target;
          const w = Math.round(en.contentRect.width);
          if (widths.get(el) === w) return;
          const first = !widths.has(el);
          widths.set(el, w);
          if (!first) run(el.getAttribute('data-draw'), el);
        }));
        document.querySelectorAll('.ec-chart[data-draw]').forEach((el) => ro.observe(el));
      }
    }
  };
})();
