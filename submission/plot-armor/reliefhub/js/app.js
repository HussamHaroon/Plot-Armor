/* ReliefHub app core: module registry, hash router, role management, landing page.
 * Owned by Team Lead; design pass (icons, skeletons, landing, scroll FX) by Eshaal. */
/* Hero media per module — videos on most pages, a photo on inventory.
 * If an asset 404s the banner removes itself so the page never looks broken. */
const BANNERS = {
  dashboard:  { kind: 'video', src: 'assets/videos/volunteers-hero.mp4',   caption: 'Coordinating relief where it matters most', eager: true },
  camps:      { kind: 'video', src: 'assets/videos/flood-aerial.mp4',      caption: '8 camps across Sindh' },
  dispatches: { kind: 'video', src: 'assets/videos/humanitarian-aid.mp4',  caption: 'Aid on the move to every camp' },
  donations:  { kind: 'video', src: 'assets/videos/donation-boxes.mp4',    caption: 'Every donation reaches a family' },
  volunteers: { kind: 'video', src: 'assets/videos/volunteers-teamwork.mp4', caption: 'Teams on the ground, around the clock' },
  needs:      { kind: 'video', src: 'assets/videos/aid-hands-loop.mp4',    caption: 'Critical needs, tracked in real time' },
  inventory:  { kind: 'image', src: 'assets/images/supply-boxes.jpg',      caption: 'Supplies counted, packed and ready' },
};

/* One consistent inline-SVG icon set (18px, stroke style) for the nav — no emoji.
 * Falls back to the module's own icon if a module isn't covered here. */
const ICONS = {
  home: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><path d='M9 22V12h6v10'/></svg>",
  dashboard: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M18 20V10M12 20V4M6 20v-6'/></svg>",
  camps: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 21 12 4l9 17z'/><path d='M12 21v-5'/></svg>",
  inventory: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/><path d='M3.27 6.96 12 12.01l8.73-5.05'/><path d='M12 22.08V12'/></svg>",
  needs: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><rect x='8' y='2' width='8' height='4' rx='1'/><path d='M9 12h6M9 16h4'/></svg>",
  dispatches: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='1' y='3' width='15' height='13' rx='1'/><path d='M16 8h4l3 3v5h-7V8z'/><circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/></svg>",
  donations: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'/></svg>",
  volunteers: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg>",
  priority: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83'/><circle cx='12' cy='12' r='3'/></svg>",
  opsmap: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>",
  simulator: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'/></svg>",
  opsfeed: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16'/><circle cx='5' cy='19' r='1'/></svg>",
};

function svgIcon(html) {
  const span = document.createElement('span');
  span.className = 'nav-ico';
  span.innerHTML = html;
  return span;
}

const App = {
  modules: [],
  state: { role: localStorage.getItem('rh_role') || 'coordinator' },
  _renderSeq: 0,
  _revealIO: null,
  _statsIO: null,
  _progressBar: null,
  _fxQueued: false,

  registerModule(mod) {
    this.modules.push(mod);
    this.modules.sort((a, b) => (a.order || 99) - (b.order || 99));
  },

  get current() { return location.hash.replace('#/', '') || this.modules[0].id; },

  /* Only the Relief Coordinator (Admin) may mutate data; Field Volunteers get read-only views. */
  canEdit() { return this.state.role === 'coordinator'; },

  setRole(role) {
    this.state.role = role;
    localStorage.setItem('rh_role', role);
    this.render();
  },

  renderNav() {
    const nav = document.getElementById('main-nav');
    nav.innerHTML = '';
    for (const m of this.modules) {
      const ico = ICONS[m.id]
        ? svgIcon(ICONS[m.id])
        : (m.icon ? UI.h('span', { class: 'nav-ico' }, m.icon) : null);
      nav.append(UI.h('a', {
        class: 'nav-item' + (this.current === m.id ? ' active' : ''),
        href: '#/' + m.id,
      }, [ico, m.title]));
    }
  },

  /* Builds the media banner for a module (or null when it has none). */
  buildBanner(modId) {
    const b = BANNERS[modId];
    if (!b) return null;
    let media;
    if (b.kind === 'video') {
      media = UI.h('video', {
        src: b.src, autoplay: '', loop: '', muted: '', playsinline: '',
        preload: b.eager ? 'auto' : 'metadata',
        onerror: () => banner.remove(),
      });
      media.muted = true; /* the attribute alone isn't honoured by every browser */
    } else {
      media = UI.h('img', {
        src: b.src, alt: b.caption,
        onerror: () => banner.remove(),
      });
    }
    const banner = UI.h('div', { class: 'page-banner' }, [
      media,
      UI.h('span', { class: 'banner-caption' }, b.caption),
    ]);
    return banner;
  },

  /* Skeleton shown in the view while a module's async render is in flight. */
  buildSkeleton() {
    return UI.h('div', { class: 'view-skeleton', 'aria-hidden': 'true' }, [
      UI.h('div', { class: 'skel-kpis' },
        Array.from({ length: 4 }, () => UI.h('div', { class: 'skel skel-card' }))),
      UI.h('div', { class: 'skel skel-table' }),
    ]);
  },

  /* Tags KPI cards with data-kpi so CSS can mount the right icon chip per metric. */
  decorateKpis(root) {
    const map = [
      [/camp/i, 'camps'], [/famil|shelter/i, 'families'], [/fulfil/i, 'fulfilment'],
      [/stock|inventory|item/i, 'stock'], [/volunteer/i, 'volunteers'],
      [/cash|zakat|sponsor|general/i, 'cash'], [/in-kind|kind/i, 'inkind'],
    ];
    root.querySelectorAll('.card').forEach(card => {
      const label = (card.querySelector('.card-label') || {}).textContent || '';
      for (const [re, kpi] of map) {
        if (re.test(label)) { card.dataset.kpi = kpi; return; }
      }
      card.dataset.kpi = 'activity';
    });
  },

  /* Fade+slide reveal for .reveal elements once they enter the viewport.
   * Revealing a row also triggers any data-w progress fills inside it. */
  observeReveals(root) {
    if (this._revealIO) this._revealIO.disconnect();
    const els = root.querySelectorAll('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(el => { el.classList.add('revealed'); this._fillBars(el); });
      return;
    }
    this._revealIO = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('revealed');
          this._fillBars(en.target);
          this._revealIO.unobserve(en.target);
        }
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -36px 0px' });
    els.forEach(el => this._revealIO.observe(el));
  },

  /* Progress fills tagged data-w render at width:0 and ease to their target
   * once their row reveals (critical-needs teaser on #/home). Bars without
   * data-w — every module page — are untouched. */
  _fillBars(scope) {
    scope.querySelectorAll('.progress > div[data-w]').forEach(f => {
      f.style.width = f.dataset.w + '%';
    });
  },

  _reduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },

  /* One rAF-throttled scroll pass: top progress bar, banner parallax, hero depth. */
  _scrollFX() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    if (this._progressBar) {
      this._progressBar.style.width = (max > 4 ? Math.min(y / max, 1) * 100 : 0) + '%';
    }
    if (this._reduceMotion()) return;
    /* banner media drifts down slightly while the card stays put — depth, transform-only */
    const media = document.querySelector('.page-banner video, .page-banner img');
    if (media) media.style.transform = 'translate3d(0,' + Math.min(y * 0.08, 30) + 'px,0) scale(1.06)';
    /* landing hero: slow zoom + drift as the page scrolls away from it */
    const hero = document.querySelector('.home-hero-media');
    if (hero) {
      const drift = Math.min(y * 0.22, 220);
      const zoom = 1 + Math.min(y * 0.00035, 0.1);
      hero.style.transform = 'translate3d(0,' + drift + 'px,0) scale(' + zoom + ')';
    }
  },

  _queueScrollFX() {
    if (this._fxQueued) return;
    this._fxQueued = true;
    requestAnimationFrame(() => { this._fxQueued = false; this._scrollFX(); });
  },

  async render() {
    const seq = ++this._renderSeq;
    const view = document.getElementById('view');
    const mod = this.modules.find(m => m.id === this.current) || this.modules[0];
    const landing = !!mod.landing;
    document.body.dataset.route = mod.id;
    document.body.classList.toggle('route-home', landing);
    if (this._revealIO) this._revealIO.disconnect();
    if (this._statsIO) this._statsIO.disconnect();
    this.renderNav();
    view.innerHTML = '';
    let skeleton = null;
    if (!landing) {
      const banner = this.buildBanner(mod.id);
      if (banner) view.append(banner);
      view.append(UI.h('div', { class: 'page-head' }, [
        UI.h('h1', {}, mod.title),
        UI.h('p', { class: 'page-sub' }, mod.subtitle || ''),
      ]));
      skeleton = this.buildSkeleton();
      view.append(skeleton);
    }
    try {
      const node = await mod.render(view);
      if (seq !== this._renderSeq) return; /* a newer render superseded this one */
      if (skeleton) skeleton.remove();
      view.append(node);
      this.decorateKpis(node);
      this.observeReveals(node);
      this._queueScrollFX();
    } catch (err) {
      if (skeleton) skeleton.remove();
      view.append(UI.h('div', { class: 'error-box' }, `Failed to load ${mod.title}: ${err.message}`));
    }
  },

  boot() {
    const roleSelect = document.getElementById('role-select');
    roleSelect.value = this.state.role;
    roleSelect.addEventListener('change', e => this.setRole(e.target.value));
    window.addEventListener('hashchange', () => this.render());
    /* scroll-driven polish: reading progress + parallax (rAF-throttled, passive) */
    this._progressBar = UI.h('div', { class: 'scroll-progress', 'aria-hidden': 'true' });
    document.body.append(this._progressBar);
    window.addEventListener('scroll', () => this._queueScrollFX(), { passive: true });
    window.addEventListener('resize', () => this._queueScrollFX(), { passive: true });
    if (!location.hash) location.hash = '#/' + this.modules[0].id;
    this.render();
  },
};

/* --------------------------------------------------------------------------
 * Landing page (#/home) — opens first. Read-only: real numbers from the API,
 * real photos, no mutations. Lives here (not in js/modules/) so module files
 * stay owned by their original authors.
 * ------------------------------------------------------------------------ */
App.registerModule({
  id: 'home', title: 'Home', order: -1, landing: true,
  subtitle: 'One shared view for flood response',

  async render() {
    /* Real numbers, best effort — the landing page still renders if the API sleeps. */
    let camps = [], needs = [], inventory = [], volunteers = [];
    try {
      [camps, needs, inventory, volunteers] = await Promise.all([
        API.list('camps'), API.list('needs'), API.list('inventory'), API.list('volunteers'),
      ]);
    } catch (e) { /* keep empty arrays; the stats strip shows dashes */ }

    const campById = Object.fromEntries(camps.map(c => [c.id, c]));
    const itemById = Object.fromEntries(inventory.map(i => [i.id, i]));
    const activeCamps = camps.filter(c => c.status !== 'Closed');
    const families = activeCamps.reduce((s, c) => s + (+c.current_families || 0), 0);
    const reqTotal = needs.reduce((s, n) => s + +n.required_quantity, 0);
    const fulTotal = needs.reduce((s, n) => s + +n.fulfilled_quantity, 0);
    const overall = reqTotal ? Math.round((fulTotal / reqTotal) * 100) : 0;
    const deployed = volunteers.filter(v => v.camp_id != null).length;

    /* Critical gaps teaser — same rule as the dashboard: High priority under 40%. */
    const gaps = needs
      .filter(n => n.priority === 'High' && UI.pct(+n.fulfilled_quantity, +n.required_quantity) < 40)
      .sort((a, b) => UI.pct(+a.fulfilled_quantity, +a.required_quantity)
        - UI.pct(+b.fulfilled_quantity, +b.required_quantity))
      .slice(0, 3);

    const root = UI.h('div', { class: 'home' });

    /* ---- Hero ---- */
    root.append(UI.h('section', { class: 'home-hero' }, [
      UI.h('video', {
        class: 'home-hero-media', src: 'assets/videos/volunteers-hero.mp4',
        autoplay: '', loop: '', muted: '', playsinline: '', preload: 'auto',
        poster: 'assets/images/tents-aerial.jpg',
      }),
      UI.h('div', { class: 'home-hero-overlay' }),
      UI.h('div', { class: 'home-hero-content' }, [
        UI.h('p', { class: 'home-eyebrow' }, 'Sindh Flood Response · Live 2026'),
        UI.h('h1', {}, [
          UI.h('span', { class: 'home-hero-brand' }, 'ReliefHub'),
          'One shared view for flood response',
        ]),
        UI.h('p', { class: 'home-hero-sub' },
          'Eight camps, thousands of families, one operations dashboard — track needs, dispatch aid and coordinate volunteers in real time.'),
        UI.h('div', { class: 'home-hero-ctas' }, [
          UI.h('a', { class: 'btn btn-primary btn-lg', href: '#/dashboard' }, 'Open Dashboard'),
          UI.h('a', { class: 'btn btn-home-ghost btn-lg', href: '#/camps' }, 'Explore Camps'),
        ]),
        UI.h('div', { class: 'home-scroll-hint', 'aria-hidden': 'true' }, [
          'Scroll to explore',
          (() => {
            const s = document.createElement('span');
            s.className = 'scroll-hint-ico';
            s.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 5v14M5 12l7 7 7-7'/></svg>";
            return s;
          })(),
        ]),
      ]),
    ]));
    /* muted must also be set as a property for every browser */
    root.querySelector('.home-hero-media').muted = true;

    /* ---- Mission: what we coordinate ---- */
    const features = [
      { img: 'assets/images/relief-camp.jpg', title: 'Camps',
        copy: 'A live registry of every relief camp — capacity, occupancy and status across all eight sites, searchable by name or district.',
        link: '#/camps', linkLabel: 'Explore camps' },
      { img: 'assets/images/logistics-truck.jpg', title: 'Dispatches',
        copy: 'Aid leaves the warehouse with a reservation on stock and lands as a confirmed delivery — nothing ships twice, nothing disappears.',
        link: '#/dispatches', linkLabel: 'Track dispatches' },
      { img: 'assets/images/volunteers-group.jpg', title: 'Volunteers',
        copy: 'Every volunteer is matched to a camp and deployed where the need is loudest, with skills and availability on record.',
        link: '#/volunteers', linkLabel: 'Meet the teams' },
    ];
    root.append(UI.h('section', { class: 'home-section home-mission' }, [
      UI.h('div', { class: 'home-wrap' }, [
        UI.h('p', { class: 'home-kicker' }, 'What we coordinate'),
        UI.h('h2', {}, 'Three moving parts, one shared picture'),
        UI.h('div', { class: 'home-features' }, features.map((f, i) =>
          UI.h('article', { class: 'feature-card reveal', style: `--d:${i * 110}ms` }, [
            /* inner wrapper takes the hover tilt so it never fights the reveal transform */
            UI.h('div', { class: 'feature-tilt' }, [
              UI.h('img', { class: 'feature-img', src: f.img, alt: f.title + ' — relief operations photo', loading: 'lazy', decoding: 'async' }),
              UI.h('div', { class: 'feature-body' }, [
                UI.h('h3', {}, f.title),
                UI.h('p', {}, f.copy),
                UI.h('a', { class: 'feature-link', href: f.link }, f.linkLabel + ' →'),
              ]),
            ]),
          ]))),
      ]),
    ]));

    /* ---- Live stats strip (count-up once visible) ---- */
    const stats = [
      { label: 'Active camps', value: activeCamps.length, format: v => String(v) },
      { label: 'Families sheltered', value: families, format: v => v.toLocaleString() },
      { label: 'Overall fulfilment', value: overall, format: v => v + '%' },
      { label: 'Volunteers deployed', value: deployed, format: v => String(v) },
    ];
    const statsBand = UI.h('section', { class: 'home-section home-stats' }, [
      UI.h('div', { class: 'home-wrap' }, [
        UI.h('p', { class: 'home-kicker kicker-light' }, 'Live right now'),
        UI.h('div', { class: 'home-stats-grid' }, stats.map((s, i) =>
          UI.h('div', { class: 'stat reveal', style: `--d:${i * 80}ms` }, [
            UI.h('div', { class: 'stat-numeral' }, '—'),
            UI.h('div', { class: 'stat-label' }, s.label),
          ]))),
      ]),
    ]);
    root.append(statsBand);

    /* ---- Critical needs teaser ---- */
    const gapRows = gaps.length
      ? gaps.map((n, i) => {
        const p = UI.pct(+n.fulfilled_quantity, +n.required_quantity);
        const color = p < 25 ? 'var(--bad)' : 'var(--warn)';
        return UI.h('div', { class: 'gap-row reveal', style: `--d:${i * 80}ms` }, [
          UI.h('div', { class: 'gap-meta' }, [
            UI.h('span', { class: 'gap-item' }, (itemById[n.inventory_item_id] || {}).name || 'Supplies'),
            UI.h('span', { class: 'gap-camp' }, 'at ' + ((campById[n.camp_id] || {}).name || 'Camp ' + n.camp_id)),
          ]),
          UI.h('div', { class: 'need-progress' }, [
            /* starts empty; eases to the data-w target once the row reveals */
            UI.h('div', { class: 'progress' }, UI.h('div', { style: `width:0%;background:${color}`, 'data-w': String(Math.min(p, 100)) })),
            UI.h('span', {}, p + '%'),
          ]),
        ]);
      })
      : UI.h('p', { class: 'gap-none' }, 'No critical gaps right now — every high-priority need is above 40% fulfilled.');
    root.append(UI.h('section', { class: 'home-section home-needs' }, [
      UI.h('div', { class: 'home-wrap' }, [
        UI.h('p', { class: 'home-kicker' }, 'Where help is needed most'),
        UI.h('h2', {}, 'Critical needs, tracked in real time'),
        UI.h('p', { class: 'home-lede' },
          'High-priority needs still under 40% fulfilment, worst first. The dashboard keeps the full list — this is the top of it.'),
        UI.h('div', { class: 'gap-list' }, gapRows),
        UI.h('a', { class: 'btn btn-primary', href: '#/dashboard' }, 'Open the dashboard'),
      ]),
    ]));

    /* ---- Footer ---- */
    root.append(UI.h('footer', { class: 'home-footer' }, [
      UI.h('div', { class: 'home-wrap home-footer-row' }, [
        UI.h('span', {}, 'ReliefHub — flood relief coordination'),
        UI.h('span', { class: 'home-footer-credit' }, 'Team Plot Armor · HacktoberFest 3.0 · 2026'),
        UI.h('span', { class: 'home-footer-credit' }, 'Media: Unsplash'),
      ]),
    ]));

    /* Count-up waits until the stats strip scrolls into view; cards get pointer tilt. */
    this._observeCountUps(root, stats);
    this._setupTilt(root);
    return root;
  },

  /* Subtle 3D tilt on hover: pointer position drives --tx/--ty custom props;
   * the inner .feature-tilt wrapper rotates (perspective from the card) and
   * springs back on leave. Skipped for reduced motion and touch devices. */
  _setupTilt(root) {
    if (App._reduceMotion()) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    root.querySelectorAll('.feature-card').forEach(card => {
      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;   /* -0.5 .. 0.5 across the card */
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--ty', (px * 7).toFixed(2) + 'deg');
        card.style.setProperty('--tx', (-py * 5).toFixed(2) + 'deg');
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--tx', '0deg');
        card.style.setProperty('--ty', '0deg');
      });
    });
  },

  /* Count-up triggers when the stats strip scrolls into view (once), so the
   * numbers spin up in front of whoever is scrolling instead of on page load.
   * Reduced motion (or no IntersectionObserver) lands the values immediately.
   * Works unchanged in demo mode: api.js falls back to bundled db.json, the
   * strip just counts up the demo numbers the same way. */
  _observeCountUps(root, stats) {
    const run = () => this._runCountUps(root, stats);
    const band = root.querySelector('.home-stats');
    if (App._reduceMotion() || !band || !('IntersectionObserver' in window)) return run();
    /* lives on App so render()'s route-change cleanup can disconnect it */
    if (App._statsIO) App._statsIO.disconnect();
    App._statsIO = new IntersectionObserver(entries => {
      if (entries.some(en => en.isIntersecting)) {
        App._statsIO.disconnect();
        run();
      }
    }, { threshold: 0.3 });
    App._statsIO.observe(band);
  },

  _runCountUps(root, stats) {
    const numerals = root.querySelectorAll('.stat-numeral');
    numerals.forEach((el, i) => {
      const s = stats[i];
      if (!s) return;
      const finish = () => {
        el.textContent = s.format(s.value);
        /* soft brand-glow pulse as each counter lands */
        el.classList.add('count-done');
        const stat = el.closest('.stat');
        if (stat) stat.classList.add('stat-done');
      };
      if (App._reduceMotion()) return finish();
      const t0 = performance.now(), dur = 1100;
      (function tick(t) {
        const p = Math.min((t - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = s.format(Math.round(s.value * eased));
        if (p < 1) requestAnimationFrame(tick); else finish();
      })(t0);
    });
  },
});

window.addEventListener('load', () => App.boot());
