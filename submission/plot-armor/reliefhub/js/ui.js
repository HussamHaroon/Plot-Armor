/* ReliefHub shared UI helpers — use these in all modules for a consistent look. */
const UI = {
  /* DOM builder: h('div', {class:'x', onclick: fn}, [children]) */
  h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'type' || k === 'placeholder' || k === 'min' || k === 'max' || k === 'step') el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      el.append(c instanceof Node ? c : document.createTextNode(c));
    }
    return el;
  },

  /* Table renderer. columns: [{key, label, render?(row)}] */
  table(columns, rows, emptyText = 'No records found.') {
    if (!rows.length) return this.h('p', { class: 'empty' }, emptyText);
    const thead = this.h('thead', {}, this.h('tr', {}, columns.map(c => this.h('th', {}, c.label))));
    const tbody = this.h('tbody', {}, rows.map(r => this.h('tr', {},
      columns.map(c => this.h('td', {}, c.render ? c.render(r) : (r[c.key] ?? ''))))));
    return this.h('table', { class: 'data-table' }, [thead, tbody]);
  },

  /* Badge with tone: ok (green), warn (amber), bad (red), info (blue), muted (gray) */
  badge(text, tone = 'muted') {
    return this.h('span', { class: `badge badge-${tone}` }, String(text));
  },

  /* Status badge tuned for camp/dispatch states */
  statusBadge(status) {
    const map = {
      Active: 'ok', Full: 'warn', Closed: 'bad',
      Pending: 'warn', 'In Transit': 'info', Delivered: 'ok', Cancelled: 'muted',
    };
    return this.badge(status, map[status] || 'muted');
  },

  /* Priority badge: High red, Medium amber, Low green */
  priorityBadge(p) {
    return this.badge(p, p === 'High' ? 'bad' : p === 'Medium' ? 'warn' : 'ok');
  },

  /* Simple modal. Returns overlay element; content appended into body. */
  modal(title, contentEl) {
    const close = () => overlay.remove();
    const overlay = this.h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } }, [
      this.h('div', { class: 'modal' }, [
        this.h('div', { class: 'modal-head' }, [
          this.h('h3', {}, title),
          this.h('button', { class: 'btn btn-ghost', onclick: close }, '✕'),
        ]),
        contentEl,
      ]),
    ]);
    document.body.append(overlay);
    return { el: overlay, close };
  },

  confirm(message) {
    return window.confirm(message);
  },

  toast(message, type = 'info') {
    const t = this.h('div', { class: `toast toast-${type}` }, message);
    document.body.append(t);
    setTimeout(() => t.remove(), 3200);
  },

  pct(fulfilled, required) {
    if (!required) return 0;
    return Math.round((fulfilled / required) * 100);
  },

  /* Form builder. fields: [{name, label, type?, options?, required?, min?, placeholder?}]
   * Returns {el, getValues(): object|null (null when validation fails)}. */
  form(fields) {
    const inputs = {};
    const els = fields.map(f => {
      let input;
      if (f.options) {
        input = this.h('select', {}, f.options.map(o => this.h('option', { value: o }, o)));
      } else {
        input = this.h('input', { type: f.type || 'text', placeholder: f.placeholder || '', min: f.min, step: f.step });
      }
      if (f.required !== false) input.required = true;
      input.addEventListener('input', () => input.classList.remove('invalid'));
      inputs[f.name] = input;
      return this.h('label', { class: 'field' }, [this.h('span', {}, f.label), input]);
    });
    return {
      el: this.h('div', { class: 'form' }, els),
      getValues() {
        const values = {};
        for (const f of fields) {
          const v = inputs[f.name].value.trim();
          const num = f.type === 'number';
          if ((f.required !== false) && (num ? v === '' || isNaN(+v) : !v)) {
            inputs[f.name].classList.add('invalid');
            UI.toast(`${f.label} is required`, 'error');
            return null;
          }
          values[f.name] = num ? +v : v;
          if (num && f.min != null && values[f.name] < f.min) {
            inputs[f.name].classList.add('invalid');
            UI.toast(`${f.label} must be ≥ ${f.min}`, 'error');
            return null;
          }
        }
        return values;
      },
    };
  },
};
