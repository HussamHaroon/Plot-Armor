/* MODULE: Ops Map — stylized Sindh operations map. OWNER: Eshaal (@Eshaal607)
 *
 * One new file on purpose: the lead adds the script tag + nav entry at merge
 * time, so this module self-registers and injects its own small stylesheet
 * (same trick camps.js uses with a link tag, just inline since I ship one file).
 *
 * Design decisions: the province outline is a hand-simplified Sindh silhouette —
 * wide arable north, the Kirthar range wall on the west, the Rann/delta coast
 * and the Thar edge on the east. Points are stored as real lat/lon and drawn
 * through one linear projection, so camp markers (positioned by their real
 * district geography) land where the geography says. Marker size = families
 * sheltered, marker colour = fulfilment health joined per camp — healthy >=60%
 * green, strained 30-59% amber, critical <30% red, using the same
 * sum(fulfilled)/sum(required) rule as the dashboard's Overall Fulfilment KPI.
 * A believable stylization, not survey-accurate.
 *  - Hover or focus a marker (or a row in the side list) for a tooltip with
 *    camp name, families x/y, fulfilment % and status; hover highlights sync
 *    between map and list; click/Enter goes to the camps registry. Everything
 *    is read-only for every role.
 *  - Works unchanged in demo mode: it only calls API.list, which falls back
 *    to the bundled db.json when the API is asleep.
 */
(function () {
  if (!document.getElementById('opsmap-module-css')) {
    const style = document.createElement('style');
    style.id = 'opsmap-module-css';
    style.textContent = [
      '/* injected by js/modules/opsmap.js — scoped under .ops- */',
      '.ops-map-panel {',
      '  position: relative; flex: 1 1 460px; min-width: 300px;',
      '  background: linear-gradient(165deg, #0a4736 0%, #083d2e 55%, #052a1f 100%);',
      '  border-radius: var(--r-lg); padding: var(--sp-5);',
      '  box-shadow: 0 24px 48px -28px rgba(8, 61, 46, .65), inset 0 1px 0 rgba(209, 250, 229, .07);',
      '  overflow: hidden;',
      '}',
      '.ops-map-panel svg { display: block; width: 100%; height: auto; }',
      '.ops-mark { width: 30px; height: 36px; position: absolute; top: 14px; right: 18px; opacity: .75; }',
      '.ops-plate {',
      '  position: absolute; top: 16px; left: 20px;',
      '  font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .22em;',
      '  color: rgba(209, 250, 229, .55); text-transform: uppercase; pointer-events: none;',
      '}',
      '.ops-province { fill: rgba(16, 185, 129, .13); stroke: #34d399; stroke-width: 1.6; stroke-linejoin: round; }',
      '.ops-grid line { stroke: rgba(209, 250, 229, .09); stroke-width: 1; }',
      '.ops-river { fill: none; stroke: rgba(147, 226, 199, .35); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 1 7; }',
      '.ops-wrap { display: flex; gap: var(--sp-4); align-items: stretch; flex-wrap: wrap; }',
      '.ops-side { flex: 0 1 340px; min-width: 260px; display: flex; flex-direction: column; gap: var(--sp-2); }',
      '.ops-side-title { margin: 0 0 2px; font-size: var(--fs-md); font-weight: 700; }',
      '.ops-row {',
      '  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;',
      '  background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-md);',
      '  padding: 9px 12px; cursor: pointer; font-family: var(--font-body); color: var(--ink);',
      '  transition: border-color var(--dur-1) var(--ease), box-shadow var(--dur-2) var(--ease),',
      '              transform var(--dur-2) cubic-bezier(0.19, 1, 0.22, 1);',
      '}',
      '.ops-row:hover, .ops-row:focus-visible, .ops-row.hot {',
      '  border-color: var(--brand-strong); box-shadow: 0 0 0 3px rgba(16, 185, 129, .16);',
      '  transform: translateX(3px); outline: none;',
      '}',
      '.ops-dot { flex: none; width: 13px; height: 13px; border-radius: 50%; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .35); }',
      '.ops-row-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }',
      '.ops-row-name { font-size: var(--fs-sm); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.ops-row-sub { font-size: var(--fs-2xs); color: var(--muted); }',
      '.ops-row-pct { margin-left: auto; flex: none; }',
      '.ops-marker .core, .ops-marker .ring { transform-box: fill-box; transform-origin: center;',
      '  transition: transform var(--dur-2) var(--ease); }',
      '.ops-marker:hover .core, .ops-marker:focus-visible .core, .ops-marker.m-hot .core { transform: scale(1.22); }',
      '.ops-marker:hover .ring, .ops-marker:focus-visible .ring, .ops-marker.m-hot .ring { transform: scale(1.3); }',
      '.ops-marker:focus-visible .ring { stroke: #d1fae5; stroke-width: 2; }',
      '.ops-marker text { font-family: var(--font-body, sans-serif); font-size: 11.5px; font-weight: 600;',
      '  fill: #d1fae5; paint-order: stroke; stroke: rgba(5, 42, 31, .85); stroke-width: 3px; pointer-events: none; }',
      '.ops-marker.tone-bad .core { animation: ops-pulse 2.2s var(--ease) infinite; }',
      '@keyframes ops-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.28); } }',
      '.ops-legend { display: flex; gap: var(--sp-5); flex-wrap: wrap; align-items: center; }',
      '.ops-legend-item { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-sm); color: var(--ink-soft); }',
      '.ops-legend-item .sw { flex: none; width: 12px; height: 12px; border-radius: 50%; }',
      '.ops-legend-item svg { display: block; }',
      '.ops-explainer { margin: var(--sp-3) 0 0; color: var(--muted); font-size: var(--fs-sm); }',
      '.ops-note { margin-left: auto; font-size: var(--fs-2xs); color: var(--muted); font-variant-numeric: tabular-nums; }',
      '@media (max-width: 860px) { .ops-note { margin-left: 0; width: 100%; } }',
      '.ops-tip {',
      '  position: absolute; z-index: 6; min-width: 175px; pointer-events: none;',
      '  background: #052a1f; color: #d1fae5; border: 1px solid rgba(52, 211, 153, .4);',
      '  border-radius: var(--r-sm); padding: 9px 12px; box-shadow: 0 14px 28px -12px rgba(0, 0, 0, .55);',
      '  opacity: 0; transform: translate(-50%, calc(-100% - 12px)) translateY(4px);',
      '  transition: opacity var(--dur-2) var(--ease), transform var(--dur-2) cubic-bezier(0.19, 1, 0.22, 1);',
      '}',
      '.ops-tip.show { opacity: 1; transform: translate(-50%, calc(-100% - 12px)) translateY(0); }',
      '.ops-tip.below { transform: translate(-50%, 16px); }',
      '.ops-tip.show.below { transform: translate(-50%, 16px); }',
      '.ops-tip-name { font-size: var(--fs-sm); font-weight: 700; margin-bottom: 3px; padding-right: 8px; }',
      '.ops-tip-row { font-size: var(--fs-2xs); color: #a7f3d0; display: flex; justify-content: space-between; gap: 14px; }',
      '.ops-tip .badge { margin-top: 6px; }',
    ].join('\n');
    document.head.append(style);
  }
})();

App.registerModule({
  id: 'opsmap', title: 'Ops Map', icon: '🗺️', order: 8,
  subtitle: 'Sindh at a glance — camps sized by families, coloured by fulfilment',

  /* One linear projection shared by the outline, the river and (soon) markers:
   * x = (lon - 66.5) * 131 + 31.5 ; y = (28.7 - lat) * 95 + 30 (600x520 box). */
  PROJ(lon, lat) { return [(lon - 66.5) * 131 + 31.5, (28.7 - lat) * 95 + 30]; },

  /* Simplified Sindh silhouette, clockwise from the Kirthar crest (NW). */
  OUTLINE: [
    [67.15, 28.10], [67.70, 28.45], [68.60, 28.55], [69.35, 28.30], [69.75, 28.50],
    [70.05, 27.65], [70.35, 27.05], [70.05, 26.30], [69.75, 25.75], [70.10, 25.30],
    [69.80, 24.85], [69.45, 24.35], [69.05, 24.10], [68.70, 23.95], [68.15, 24.05],
    [67.65, 24.15], [67.40, 23.95], [67.25, 24.40], [66.95, 24.65], [66.85, 24.90],
    [66.75, 25.40], [67.05, 25.85], [66.85, 26.30], [67.10, 26.80], [66.90, 27.15],
    [67.15, 27.65],
  ],

  /* The Indus: from the north, past Sukkur and Hyderabad, out through the delta. */
  RIVER: [
    [69.00, 28.20], [68.85, 27.70], [68.55, 27.20], [68.10, 26.75], [67.85, 26.42],
    [68.15, 26.10], [68.35, 25.75], [68.37, 25.38], [68.15, 25.00], [67.90, 24.70],
    [67.55, 24.30], [67.35, 24.00],
  ],

  /* Approximate district seats — consistent positions, not survey data. */
  GEO: {
    sukkur:    { lat: 27.70, lon: 68.85, label: 'end' },   /* north             */
    larkana:   { lat: 27.56, lon: 68.20, label: 'end' },   /* northwest         */
    khairpur:  { lat: 27.30, lon: 68.90, label: 'start' }, /* centre-north-east */
    nawabshah: { lat: 26.25, lon: 68.40, label: 'start' }, /* centre            */
    jamshoro:  { lat: 25.43, lon: 68.00, label: 'end' },   /* centre-west       */
    hyderabad: { lat: 25.38, lon: 68.37, label: 'start' }, /* south-centre      */
    thatta:    { lat: 24.75, lon: 67.90, label: 'start' }, /* south-west coast  */
    badin:     { lat: 24.65, lon: 68.85, label: 'start' }, /* south-east        */
  },

  HEALTH: {
    ok:   { color: '#10b981', label: 'Healthy' },
    warn: { color: '#d97706', label: 'Strained' },
    bad:  { color: '#dc2626', label: 'Critical' },
  },

  /* Fulfilment per camp: join needs on camp_id, sum(fulfilled)/sum(required) —
   * same rule as the dashboard KPI. No open needs -> neutral green. */
  campHealth(camp, needs) {
    const mine = needs.filter(n => String(n.camp_id) === String(camp.id));
    if (!mine.length) return { pct: null, tone: 'ok', color: this.HEALTH.ok.color, label: 'No open needs' };
    const req = mine.reduce((s, n) => s + (+n.required_quantity || 0), 0);
    const ful = mine.reduce((s, n) => s + (+n.fulfilled_quantity || 0), 0);
    if (!req) return { pct: null, tone: 'ok', color: this.HEALTH.ok.color, label: 'No open needs' };
    const pct = Math.round((ful / req) * 100);
    const tone = pct >= 60 ? 'ok' : pct >= 30 ? 'warn' : 'bad';
    return { pct, tone, color: this.HEALTH[tone].color, label: this.HEALTH[tone].label };
  },

  /* Mild Catmull-Rom smoothing so the lat/lon polyline reads as a coastline,
   * not a polygon. k small = mostly faithful with softened corners. */
  smoothPath(pts, closed, k = 0.18) {
    const p = pts.map(([lon, lat]) => this.PROJ(lon, lat));
    const n = p.length;
    const f = v => v.toFixed(1);
    let d = `M ${f(p[0][0])} ${f(p[0][1])}`;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
      const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
      d += ` C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(p2[0])} ${f(p2[1])}`;
    }
    return d + (closed ? ' Z' : '');
  },

  /* SVG DOM builder (UI.h is HTML-only, SVG needs its own namespace). */
  S(tag, attrs = {}, children = []) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.setAttribute('class', v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      el.append(c instanceof Node ? c : document.createTextNode(c));
    }
    return el;
  },

  async render() {
    const [camps, needs] = await Promise.all([API.list('camps'), API.list('needs')]);
    const self = this;

    /* Marker radius scales with families against the busiest camp. */
    const maxFam = Math.max(1, ...camps.map(c => +c.current_families || 0));
    const rows = camps.map((c, i) => {
      const geo = self.GEO[String(c.district || '').toLowerCase()] ||
        { lat: 26.1 + (i % 3) * 0.4, lon: 68.5 + (i % 4) * 0.25, label: 'start' }; /* unknown district: spread near centre */
      const [x, y] = self.PROJ(geo.lon, geo.lat);
      const closed = c.status === 'Closed';
      return {
        camp: c, health: self.campHealth(c, needs),
        x, y, anchor: geo.label,
        r: 6.5 + 9 * ((+c.current_families || 0) / maxFam),
        closed,
      };
    }).sort((a, b) => (a.health.pct ?? 101) - (b.health.pct ?? 101)); /* worst first in the list */

    const root = UI.h('div');

    /* Shared hover-sync: highlight the matching marker AND list row. */
    let mapSvg = null, tip = null;
    function setHot(campId, on) {
      const id = String(campId);
      if (mapSvg) mapSvg.querySelectorAll('.ops-marker').forEach(g =>
        g.classList.toggle('m-hot', on && g.dataset.camp === id));
      root.querySelectorAll('.ops-row').forEach(b =>
        b.classList.toggle('hot', on && b.dataset.camp === id));
    }

    const outlineD = this.smoothPath(this.OUTLINE, true);
    const riverD = this.smoothPath(this.RIVER, false, 0.22);

    const shape = this.S('path', { id: 'ops-sindh-shape', class: 'ops-province', d: outlineD });
    const clip = this.S('clipPath', { id: 'ops-sindh-clip' }, this.S('use', { href: '#ops-sindh-shape' }));

    /* faint lat/lon graticule, clipped so it only shows inside the province */
    const grid = this.S('g', { class: 'ops-grid', 'clip-path': 'url(#ops-sindh-clip)' });
    for (let lat = 24; lat <= 28; lat++) {
      const [, y] = this.PROJ(66.5, lat);
      grid.append(this.S('line', { x1: 0, y1: y, x2: 600, y2: y }));
    }
    for (let lon = 67; lon <= 70; lon++) {
      const [x] = this.PROJ(lon, 23.5);
      grid.append(this.S('line', { x1: x, y1: 0, x2: x, y2: 520 }));
    }

    /* compass needle, top-right of the panel */
    const compass = this.S('svg', { class: 'ops-mark', viewBox: '0 0 30 36', 'aria-hidden': 'true' }, [
      this.S('path', { d: 'M15 4 L21 22 L15 18 L9 22 Z', fill: '#d1fae5', opacity: .85 }),
      this.S('path', { d: 'M15 34 L11 24 L15 26.5 L19 24 Z', fill: '#34d399', opacity: .55 }),
      this.S('text', { x: 15, y: 3.4, dy: 2, 'text-anchor': 'middle', 'font-size': 6, fill: 'rgba(209,250,229,.8)' }, 'N'),
    ]);

    const markers = this.S('g');
    for (const row of rows) {
      const { camp, health, x, y, r, anchor, closed } = row;
      const go = () => { location.hash = '#/camps'; };
      const g = this.S('g', {
        class: 'ops-marker tone-' + health.tone, 'data-camp': String(camp.id),
        tabindex: '0', role: 'link',
        'aria-label': `${camp.name}, ${camp.district}: ${camp.current_families} of ${camp.capacity} families, ` +
          (health.pct == null ? 'no open needs' : health.pct + '% fulfilled') + `, status ${camp.status}. Opens the camps page.`,
        onclick: go,
        onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } },
        onpointerenter: () => { setHot(camp.id, true); showTip(row, g); },
        onpointerleave: () => { setHot(camp.id, false); hideTip(); },
        onfocus: () => { setHot(camp.id, true); showTip(row, g); },
        onblur: () => { setHot(camp.id, false); hideTip(); },
      }, [
        this.S('circle', { class: 'hit', cx: x, cy: y, r: r + 10, fill: 'transparent' }),
        this.S('circle', {
          class: 'ring', cx: x, cy: y, r: r + 4.5, fill: 'none',
          stroke: health.color, 'stroke-width': 1.4, opacity: .55,
        }),
        this.S('circle', {
          class: 'core', cx: x, cy: y, r: r,
          fill: closed ? 'rgba(8, 61, 46, .85)' : health.color,
          stroke: health.color, 'stroke-width': 2, /* closed camps render hollow */
        }),
        this.S('text', {
          x: anchor === 'end' ? x - r - 7 : x + r + 7, y: y + 4,
          'text-anchor': anchor,
        }, camp.district),
      ]);
      markers.append(g);
    }

    mapSvg = this.S('svg', {
      viewBox: '0 0 600 520', role: 'img',
      'aria-label': 'Stylized map of Sindh province with one marker per relief camp, sized by families sheltered and coloured by fulfilment health.',
    }, [clip, shape, grid, this.S('path', { class: 'ops-river', d: riverD, 'aria-hidden': 'true' }), markers]);

    /* ---- tooltip (lives over the map panel) ---- */
    tip = UI.h('div', { class: 'ops-tip', 'aria-hidden': 'true' }, [
      UI.h('div', { class: 'ops-tip-name' }),
      UI.h('div', { class: 'ops-tip-row ops-tip-fam' }),
      UI.h('div', { class: 'ops-tip-row ops-tip-ful' }),
      UI.h('div', { class: 'ops-tip-badge' }),
    ]);
    function showTip(row, g) {
      const wrap = g.closest('.ops-map-panel');
      const wr = wrap.getBoundingClientRect();
      const mr = g.querySelector('.core').getBoundingClientRect();
      tip.querySelector('.ops-tip-name').textContent = row.camp.name;
      tip.querySelector('.ops-tip-fam').innerHTML = '';
      tip.querySelector('.ops-tip-fam').append('Families', UI.h('b', {}, ` ${row.camp.current_families} / ${row.camp.capacity}`));
      tip.querySelector('.ops-tip-ful').innerHTML = '';
      tip.querySelector('.ops-tip-ful').append('Fulfilment', UI.h('b', {}, ` ${row.health.pct == null ? '—' : row.health.pct + '%'}`));
      tip.querySelector('.ops-tip-badge').innerHTML = '';
      tip.querySelector('.ops-tip-badge').append(
        UI.statusBadge(row.camp.status),
        ' ', UI.badge(row.health.label, row.health.tone));
      const cx = mr.left - wr.left + mr.width / 2;
      const cy = mr.top - wr.top;
      tip.classList.toggle('below', cy < 120); /* near the top edge: flip under the marker */
      tip.style.left = Math.max(100, Math.min(cx, wr.width - 100)) + 'px';
      tip.style.top = cy + 'px';
      tip.classList.add('show');
    }
    function hideTip() { tip.classList.remove('show'); }

    const mapPanel = UI.h('div', { class: 'ops-map-panel reveal' }, [
      UI.h('span', { class: 'ops-plate' }, 'Sindh · Flood Response 2026'),
      compass, mapSvg, tip,
    ]);

    /* ---- side list (mirrors the markers; accessible + small screens) ---- */
    const listBox = UI.h('div', { class: 'ops-side reveal', style: '--d:110ms' }, [
      UI.h('h3', { class: 'ops-side-title' }, 'All camps, worst fulfilment first'),
      ...rows.map(row => {
        const open = () => { location.hash = '#/camps'; };
        return UI.h('button', {
          class: 'ops-row', type: 'button', 'data-camp': String(row.camp.id),
          onclick: open,
          onpointerenter: () => setHot(row.camp.id, true),
          onpointerleave: () => setHot(row.camp.id, false),
          onfocus: () => setHot(row.camp.id, true),
          onblur: () => setHot(row.camp.id, false),
        }, [
        UI.h('span', { class: 'ops-dot', style: `background:${row.health.color}` }),
        UI.h('span', { class: 'ops-row-main' }, [
          UI.h('span', { class: 'ops-row-name' }, row.camp.name),
          UI.h('span', { class: 'ops-row-sub' },
            `${row.camp.district} · ${row.camp.current_families}/${row.camp.capacity} families · ${row.camp.status}`),
        ]),
        UI.h('span', { class: 'ops-row-pct' },
          UI.badge(row.health.pct == null ? 'stable' : row.health.pct + '%', row.health.tone)),
        ]);
      }),
    ]);

    /* ---- legend + one-line explainer (dashboard panel style) ---- */
    const activeCamps = camps.filter(c => c.status !== 'Closed');
    const families = activeCamps.reduce((s, c) => s + (+c.current_families || 0), 0);
    const reqTotal = needs.reduce((s, n) => s + (+n.required_quantity || 0), 0);
    const fulTotal = needs.reduce((s, n) => s + (+n.fulfilled_quantity || 0), 0);
    const overall = reqTotal ? Math.round((fulTotal / reqTotal) * 100) : null;

    const legend = UI.h('div', { class: 'panel reveal', style: '--d:220ms' }, [
      UI.h('h3', {}, 'How to read the map'),
      UI.h('div', { class: 'ops-legend' }, [
        UI.h('span', { class: 'ops-legend-item' }, [
          UI.h('span', { class: 'sw', style: 'background:#10b981' }), 'Healthy — 60%+ fulfilled',
        ]),
        UI.h('span', { class: 'ops-legend-item' }, [
          UI.h('span', { class: 'sw', style: 'background:#d97706' }), 'Strained — 30–59%',
        ]),
        UI.h('span', { class: 'ops-legend-item' }, [
          UI.h('span', { class: 'sw', style: 'background:#dc2626' }), 'Critical — under 30%',
        ]),
        UI.h('span', { class: 'ops-legend-item' }, [
          this.S('svg', { width: 30, height: 22, viewBox: '0 0 30 22', 'aria-hidden': 'true' }, [
            this.S('circle', { cx: 8, cy: 11, r: 4, fill: 'none', stroke: '#10b981', 'stroke-width': 2 }),
            this.S('circle', { cx: 22, cy: 11, r: 8.5, fill: 'rgba(16,185,129,.2)', stroke: '#10b981', 'stroke-width': 2 }),
          ]),
          'Marker size — families sheltered',
        ]),
        UI.h('span', { class: 'ops-legend-item' }, [
          UI.h('span', { class: 'sw', style: 'background:rgba(8,61,46,.85); box-shadow: inset 0 0 0 2px #10b981' }),
          'Hollow — closed camp',
        ]),
        UI.h('span', { class: 'ops-note' },
          `${camps.length} camps · ${families.toLocaleString()} families sheltered` +
          (overall == null ? '' : ` · ${overall}% overall fulfilment`)),
      ]),
      UI.h('p', { class: 'ops-explainer' },
        'Every camp on the Sindh map is sized by the families it shelters and coloured by how much of its requested aid has arrived — hover for details, click any camp or row to open the registry. The dotted line is the Indus.'),
    ]);

    return UI.h('div', {}, [UI.h('div', { class: 'ops-wrap' }, [mapPanel, listBox]), legend]);
  },
});
