dash.calc('age_35_44', {
  inputs: ['ig_age'],
  title: 'Followers aged 35 to 44',
  description: 'Women plus men in the 35 to 44 bracket, as a percent of all followers.',
  fn: (ages) => {
    const r = ages.find((x) => x.age === '35-44');
    return r ? Math.round((+r.women_pct + +r.men_pct) * 10) / 10 : null;
  }
});

dash.calc('age_total', {
  inputs: ['ig_age'],
  title: 'Followers by age',
  description: 'Women plus men in each age bracket, as a percent of all followers.',
  fn: (ages) => ages.map((r) => ({ age: r.age, pct: Math.round((+r.women_pct + +r.men_pct) * 10) / 10 }))
});

dash.calc('reel_stats', {
  inputs: ['ig_reels'],
  title: 'Reel summary',
  description: 'Count, median views, Reels over 1,000 views as a count and a percent, median engagement on reach, and the share of interactions that were saves or shares.',
  fn: (reels) => {
    const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const sum = (k) => reels.reduce((t, r) => t + (+r[k] || 0), 0);
    const views = reels.map((r) => +r.views);
    const er = reels.filter((r) => +r.reach > 0).map((r) => (+r.interactions / +r.reach) * 100);
    return [{
      reels: reels.length,
      median_views: med(views),
      over_1k: views.filter((v) => v >= 1000).length,
      over_1k_pct: Math.round((views.filter((v) => v >= 1000).length / reels.length) * 100),
      median_engagement_pct: Math.round(med(er) * 10) / 10,
      saves_shares_pct: Math.round(((sum('saves') + sum('shares')) / sum('interactions')) * 100),
      shares: sum('shares'),
      saves: sum('saves')
    }];
  }
});

dash.calc('best_reel', {
  inputs: ['ig_reels'],
  title: 'Most-viewed Reel',
  description: 'The Reel with the most views in the file.',
  fn: (reels) => {
    const top = reels.reduce((b, r) => (!b || +r.views > +b.views ? r : b), null);
    return top ? [{ reel: top.reel, published: top.published, views: +top.views, reach: +top.reach, shares: +top.shares, saves: +top.saves }] : [];
  }
});

(function () {
  const SLATE = '#768B9D', VERM = '#EB512C';
  const parseDay = d3.utcParse('%Y-%m-%d');
  const FMT = {
    int: (v) => d3.format(',')(v),
    pct: (v) => d3.format(',.4~f')(v) + '%',
    signed: (v) => (v > 0 ? '+' : '') + d3.format(',.4~f')(v) + '%',
    date: (v) => { const p = parseDay(String(v)); return p ? d3.utcFormat('%b %-d, %Y')(p) : String(v); }
  };

  function readVal(el) {
    const src = el.getAttribute('data-source');
    const field = el.getAttribute('data-field');
    const where = el.getAttribute('data-where');
    const rowAttr = el.getAttribute('data-row');
    const d = dash.data(src);
    if (d.status !== 'ok') return { status: d.status };
    if (!field) return { status: 'ok', v: d.data };
    const rows = Array.isArray(d.data) ? d.data : [];
    let row;
    if (where) {
      const i = where.indexOf('=');
      const k = decodeURIComponent(where.slice(0, i));
      const val = decodeURIComponent(where.slice(i + 1));
      row = rows.find((r) => String(r[k]) === val);
    } else {
      row = rows[+(rowAttr || 0)];
    }
    return { status: 'ok', v: row ? row[field] : null };
  }

  dash.draw('val', (el) => {
    const r = readVal(el);
    if (r.status !== 'ok') {
      if (r.status !== 'loading') el.classList.remove('dash-skeleton');
      el.textContent = '—';
      return;
    }
    el.classList.remove('dash-skeleton');
    if (r.v == null || r.v === '') {
      const empty = el.getAttribute('data-empty');
      el.textContent = empty || '—';
      el.classList.toggle('ec-na', !!empty);
      return;
    }
    el.classList.remove('ec-na');
    const fmt = el.getAttribute('data-fmt') || 'int';
    const n = +r.v;
    if (fmt === 'date') el.textContent = FMT.date(r.v);
    else el.textContent = isNaN(n) ? String(r.v) : FMT[fmt](n);
  });

  function makeTip(el) {
    const tip = document.createElement('div');
    tip.className = 'ec-tip';
    tip.hidden = true;
    el.append(tip);
    return {
      show(lines, cx, cy) {
        tip.replaceChildren();
        lines.forEach((t, i) => { const p = document.createElement('div'); p.className = i === 0 ? 'ec-tip-h' : 'ec-tip-l'; p.textContent = t; tip.append(p); });
        tip.hidden = false;
        const w = el.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
        const left = Math.max(0, Math.min(w - tw, cx - tw / 2));
        const top = Math.max(0, cy - th - 10);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      },
      hide() { tip.hidden = true; }
    };
  }

  function message(el, text) {
    const p = document.createElement('p');
    p.className = 'ec-chart-msg';
    p.textContent = text;
    el.append(p);
  }

  function hbars(el, rows, opts) {
    el.replaceChildren();
    const W = Math.max(240, el.clientWidth);
    const rowH = 28, gap = 8;
    const H = rows.length * (rowH + gap) - gap;
    const svg = d3.select(el).append('svg')
      .attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', opts.aria).attr('class', 'ec-svg');
    const labs = svg.selectAll('text.ec-tick').data(rows).join('text')
      .attr('class', 'ec-tick').attr('x', 0)
      .attr('y', (d, i) => i * (rowH + gap) + rowH / 2).attr('dy', '0.35em')
      .text((d) => d.label);
    let lw = 0;
    labs.each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
    const left = Math.ceil(lw) + 12;
    const maxV = d3.max(rows, (d) => d.value) || 1;
    const probe = svg.append('text').attr('class', 'ec-val').text(opts.fmt(maxV));
    const vw = probe.node().getComputedTextLength();
    probe.remove();
    const x = d3.scaleLinear().domain([0, maxV]).range([0, Math.max(20, W - left - vw - 10)]);
    svg.selectAll('rect.ec-bar').data(rows).join('rect')
      .attr('class', 'ec-bar')
      .attr('x', left).attr('y', (d, i) => i * (rowH + gap))
      .attr('height', rowH).attr('width', (d) => Math.max(2, x(d.value)))
      .style('fill', (d) => (d.hi ? VERM : SLATE));
    svg.selectAll('text.ec-val').data(rows).join('text')
      .attr('class', 'ec-val')
      .attr('x', (d) => left + Math.max(2, x(d.value)) + 6)
      .attr('y', (d, i) => i * (rowH + gap) + rowH / 2).attr('dy', '0.35em')
      .text((d) => opts.fmt(d.value));
    const tip = makeTip(el);
    svg.selectAll('rect.ec-hit').data(rows).join('rect')
      .attr('class', 'ec-hit')
      .attr('x', 0).attr('y', (d, i) => i * (rowH + gap) - gap / 2)
      .attr('width', W).attr('height', rowH + gap)
      .style('fill', 'transparent')
      .on('pointerenter pointerdown', (ev, d) => {
        const i = rows.indexOf(d);
        tip.show([d.label, opts.tipLine(d)], left + Math.max(2, x(d.value)) / 2, i * (rowH + gap));
      })
      .on('pointerleave', () => tip.hide());
  }

  dash.draw('age-chart', (el) => {
    const d = dash.data('age_total');
    if (d.status !== 'ok' || !Array.isArray(d.data)) {
      el.replaceChildren();
      message(el, d.status === 'error' ? 'The age breakdown could not load.' : '—');
      return;
    }
    const rows = d.data.map((r) => ({ label: r.age.replace('-', '–'), value: +r.pct, hi: r.age === '35-44' }));
    hbars(el, rows, {
      aria: 'Bar chart of followers by age. The 35 to 44 bracket is the largest.',
      fmt: (v) => d3.format('.1f')(v) + '%',
      tipLine: (r) => d3.format('.1f')(r.value) + '% of followers'
    });
  });

  dash.draw('country-chart', (el) => {
    const d = dash.data('ig_countries');
    if (d.status !== 'ok' || !Array.isArray(d.data)) {
      el.replaceChildren();
      message(el, d.status === 'error' ? 'The country breakdown could not load.' : '—');
      return;
    }
    const rows = d.data.map((r, i) => ({ label: r.country, value: +r.pct, hi: i === 0 }));
    hbars(el, rows, {
      aria: 'Bar chart of followers by country. The United States is the largest.',
      fmt: (v) => d3.format('.1f')(v) + '%',
      tipLine: (r) => d3.format('.1f')(r.value) + '% of followers'
    });
  });

  dash.draw('reel-chart', (el) => {
    const d = dash.data('ig_reels');
    const s = dash.data('reel_stats');
    el.replaceChildren();
    if (d.status !== 'ok' || !Array.isArray(d.data)) {
      message(el, d.status === 'error' ? 'The Reel chart could not load.' : '—');
      return;
    }
    const rows = d.data.map((r) => ({
      reel: r.reel, line: r.opening_line || '', date: parseDay(r.published),
      views: +r.views, reach: +r.reach, inter: +r.interactions
    }));
    const med = s.status === 'ok' && Array.isArray(s.data) && s.data[0] ? +s.data[0].median_views : null;
    const maxV = d3.max(rows, (r) => r.views) || 1;
    const W = Math.max(280, el.clientWidth), H = 250;
    const m = { t: 34, r: 4, b: 28 };
    const y = d3.scaleLinear().domain([0, maxV]).nice().range([H - m.b, m.t]);
    const svg = d3.select(el).append('svg')
      .attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('class', 'ec-svg')
      .attr('aria-label', `Bar chart of views on each of ${rows.length} Reels in date order, with a dashed line at the median.`);
    const ticks = y.ticks(3);
    const tickTexts = svg.selectAll('text.ec-ytick').data(ticks).join('text')
      .attr('class', 'ec-tick ec-ytick').attr('x', 0).attr('y', (t) => y(t)).attr('dy', '0.35em')
      .text((t) => d3.format(',')(t));
    let lw = 0;
    tickTexts.each(function () { lw = Math.max(lw, this.getComputedTextLength()); });
    const left = Math.ceil(lw) + 8;
    svg.selectAll('line.ec-grid').data(ticks).join('line')
      .attr('class', 'ec-grid').attr('x1', left).attr('x2', W - m.r)
      .attr('y1', (t) => y(t)).attr('y2', (t) => y(t));
    const x = d3.scaleBand().domain(rows.map((r) => r.reel)).range([left, W - m.r]).paddingInner(0.2);
    const bestViews = maxV;
    svg.selectAll('rect.ec-bar').data(rows).join('rect')
      .attr('class', 'ec-bar')
      .attr('x', (r) => x(r.reel)).attr('width', x.bandwidth())
      .attr('y', (r) => y(r.views)).attr('height', (r) => Math.max(1, y(0) - y(r.views)))
      .style('fill', (r) => (r.views === bestViews ? VERM : SLATE));
    let lastMonth = null;
    const monthFmt = d3.utcFormat('%b');
    const firsts = rows.filter((r) => { const mo = monthFmt(r.date); if (mo !== lastMonth) { lastMonth = mo; return true; } return false; });
    const xt = svg.selectAll('text.ec-xtick').data(firsts).join('text')
      .attr('class', 'ec-tick ec-xtick').attr('x', (r) => x(r.reel)).attr('y', H - 8)
      .text((r) => monthFmt(r.date));
    const xNodes = xt.nodes();
    for (let i = 0; i < xNodes.length - 1; i++) {
      const a = xNodes[i], b = xNodes[i + 1];
      if (+a.getAttribute('x') + a.getComputedTextLength() + 6 > +b.getAttribute('x')) a.style.display = 'none';
    }
    if (med != null) {
      svg.append('line').attr('class', 'ec-median')
        .attr('x1', left).attr('x2', W - m.r).attr('y1', y(med)).attr('y2', y(med));
      const lab = svg.append('text').attr('class', 'ec-legend').attr('x', W - m.r).attr('y', 10)
        .attr('dy', '0.35em').attr('text-anchor', 'end').text('Median ' + d3.format(',')(med) + ' views');
      const lw2 = lab.node().getComputedTextLength();
      svg.append('line').attr('class', 'ec-median')
        .attr('x1', W - m.r - lw2 - 34).attr('x2', W - m.r - lw2 - 8).attr('y1', 10).attr('y2', 10);
    }
    const tip = makeTip(el);
    const dayFmt = d3.utcFormat('%b %-d');
    const step = x.step();
    svg.selectAll('rect.ec-hit').data(rows).join('rect')
      .attr('class', 'ec-hit')
      .attr('x', (r) => x(r.reel) - (step - x.bandwidth()) / 2).attr('width', step)
      .attr('y', m.t).attr('height', H - m.t - m.b)
      .style('fill', 'transparent')
      .on('pointerenter pointerdown', (ev, r) => {
        const lines = [dayFmt(r.date)];
        if (r.line) lines.push('“' + r.line + '”');
        lines.push(d3.format(',')(r.views) + ' views', d3.format(',')(r.reach) + ' accounts reached', d3.format(',')(r.inter) + ' interactions');
        tip.show(lines, x(r.reel) + x.bandwidth() / 2, y(r.views));
      })
      .on('pointerleave', () => tip.hide());
  });

  dash.draw('overlap-rows', (tb) => {
    const d = dash.data('sub_overlap');
    tb.replaceChildren();
    if (d.status !== 'ok' || !Array.isArray(d.data)) {
      if (d.status === 'error') { const tr = tb.insertRow(); const td = tr.insertCell(); td.colSpan = 2; td.textContent = 'This list could not load.'; }
      return;
    }
    d.data.forEach((r) => {
      const tr = tb.insertRow();
      tr.insertCell().textContent = r.publication;
      const c = tr.insertCell();
      c.className = 'ec-numcell';
      c.textContent = r.overlap_pct + '%';
    });
  });

  dash.draw('essay-rows', (tb) => {
    const d = dash.data('sub_essays');
    tb.replaceChildren();
    if (d.status !== 'ok' || !Array.isArray(d.data)) {
      if (d.status === 'error') { const tr = tb.insertRow(); const td = tr.insertCell(); td.colSpan = 4; td.textContent = 'The essay list could not load.'; }
      return;
    }
    d.data.forEach((r) => {
      const tr = tb.insertRow();
      tr.insertCell().textContent = r.title;
      const c1 = tr.insertCell(); c1.className = 'ec-nowrap'; c1.textContent = FMT.date(r.published);
      const c2 = tr.insertCell(); c2.className = 'ec-numcell'; c2.textContent = d3.format(',')(+r.views);
      const c3 = tr.insertCell(); c3.className = 'ec-numcell'; c3.textContent = r.open_rate_pct + '%';
    });
  });

  // Post viewer. Reel previews play muted while on screen and pause off screen;
  // the Yoto carousel swipes, and arrows show on devices with a mouse.
  const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const seenReels = new WeakSet();
  let reelWatch = null;
  const playQuiet = (v) => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
  dash.draw('reel-preview', (el) => {
    const v = el.querySelector('video');
    if (!v || seenReels.has(v)) return;
    seenReels.add(v);
    v.muted = true;
    if (still) return;
    if (!('IntersectionObserver' in window)) { playQuiet(v); return; }
    if (!reelWatch) {
      reelWatch = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) playQuiet(en.target); else en.target.pause();
      }), { threshold: 0.35 });
    }
    reelWatch.observe(v);
  });

  const seenCars = new WeakSet();
  dash.draw('post-carousel', (el) => {
    if (seenCars.has(el)) return;
    const track = el.querySelector('.ec-car-track');
    if (!track) return;
    seenCars.add(el);
    const n = track.children.length;
    const count = el.querySelector('.ec-car-count');
    const dots = Array.from(el.querySelectorAll('.ec-car-dots span'));
    const prev = el.querySelector('.ec-car-prev');
    const next = el.querySelector('.ec-car-next');
    const at = () => Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
    let shown = -1;
    const show = () => {
      const i = at();
      if (i === shown) return;
      shown = i;
      if (count) count.textContent = (i + 1) + ' / ' + n;
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === n - 1;
    };
    const go = (step) => track.scrollTo({ left: (at() + step) * track.clientWidth, behavior: still ? 'auto' : 'smooth' });
    if (prev) prev.addEventListener('click', () => go(-1));
    if (next) next.addEventListener('click', () => go(1));
    let raf = 0;
    track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; show(); }); }, { passive: true });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
    });
    show();
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { ['age-chart', 'country-chart', 'reel-chart'].forEach((n) => dash.draw(n)); });
  }
})();
