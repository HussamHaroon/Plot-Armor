/* ReliefHub app core: module registry, hash router, role management. Owned by Team Lead. */
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

  async render() {
    const seq = ++this._renderSeq;
    this.renderNav();
    const view = document.getElementById('view');
    view.innerHTML = '';
    const mod = this.modules.find(m => m.id === this.current) || this.modules[0];
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
