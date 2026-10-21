/* ReliefHub app core: module registry, hash router, role management. Owned by Team Lead. */
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

const App = {
  modules: [],
  state: { role: localStorage.getItem('rh_role') || 'coordinator' },
  _renderSeq: 0,

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
      nav.append(UI.h('a', {
        class: 'nav-item' + (this.current === m.id ? ' active' : ''),
        href: '#/' + m.id,
      }, [m.icon ? UI.h('span', { class: 'nav-ico' }, m.icon) : null, m.title]));
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

  async render() {
    const seq = ++this._renderSeq;
    this.renderNav();
    const view = document.getElementById('view');
    view.innerHTML = '';
    const mod = this.modules.find(m => m.id === this.current) || this.modules[0];
    const banner = this.buildBanner(mod.id);
    if (banner) view.append(banner);
    view.append(UI.h('div', { class: 'page-head' }, [
      UI.h('h1', {}, mod.title),
      UI.h('p', { class: 'page-sub' }, mod.subtitle || ''),
    ]));
    try {
      const node = await mod.render(view);
      if (seq !== this._renderSeq) return; /* a newer render superseded this one */
      view.append(node);
    } catch (err) {
      view.append(UI.h('div', { class: 'error-box' }, `Failed to load ${mod.title}: ${err.message}`));
    }
  },

  boot() {
    const roleSelect = document.getElementById('role-select');
    roleSelect.value = this.state.role;
    roleSelect.addEventListener('change', e => this.setRole(e.target.value));
    window.addEventListener('hashchange', () => this.render());
    if (!location.hash) location.hash = '#/' + this.modules[0].id;
    this.render();
  },
};
window.addEventListener('load', () => App.boot());
