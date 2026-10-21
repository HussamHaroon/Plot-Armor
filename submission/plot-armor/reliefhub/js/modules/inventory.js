/* MODULE: Inventory / Warehouse (Milestone 2, part A) — OWNER: Eshaal (@Eshaal607)
 *
 * Rules from the issue:
 *  - Inventory CRUD (Coordinator only, App.canEdit()): name, category, unit,
 *    stock, reorder_level. Validate: non-empty name/category/unit, stock >= 0,
 *    reorder_level >= 0.
 *  - Highlight items at or below their reorder level as "Low Stock" badge
 *    (use UI.badge('Low Stock', 'warn') or 'bad' when stock == 0).
 *  - Search by name and/or filter by category is a plus.
 *
 * Item categories used in seed data: Food & Water, Medicine, Shelter, Hygiene,
 * Clothing, Energy — reuse these for new items (the dashboard chart groups by them).
 */
App.registerModule({
  id: 'inventory', title: 'Inventory', icon: '📦', order: 2,
  subtitle: 'Warehouse stock and reorder levels',
  async render() {
    const items = await API.list('inventory');
    const canEdit = App.canEdit();
    const root = UI.h('div');

    const CATEGORIES = ['Food & Water', 'Medicine', 'Shelter', 'Hygiene', 'Clothing', 'Energy'];

    /* Filter state — table body refreshes live from the already-loaded list. */
    let query = '';
    let category = 'All';
    const tableBox = UI.h('div');
    const countNote = UI.h('span', { class: 'toolbar-note' });

    function isLow(i) { return +i.stock <= +i.reorder_level; }

    function matches(i) {
      if (category !== 'All' && i.category !== category) return false;
      const q = query.trim().toLowerCase();
      return !q || i.name.toLowerCase().includes(q);
    }

    function refresh() {
      const visible = items.filter(matches);
      const lowCount = items.filter(isLow).length;
      countNote.textContent = `${visible.length} of ${items.length} items · ${lowCount} low stock`;
      tableBox.innerHTML = '';
      tableBox.append(UI.table(buildColumns(), visible, query || category !== 'All'
        ? 'No items match your search or filter.'
        : (canEdit ? 'No inventory items yet — add the first one.' : 'No inventory items registered yet.')));
    }

    function openItemForm(item) {
      const fields = [
        { name: 'name', label: 'Item Name', placeholder: 'e.g. Mineral Water Bottles (1.5L)' },
        { name: 'category', label: 'Category', options: CATEGORIES },
        { name: 'unit', label: 'Unit', placeholder: 'e.g. carton, box, kit' },
        { name: 'stock', label: 'Stock', type: 'number', min: 0, placeholder: '0' },
        { name: 'reorder_level', label: 'Reorder Level', type: 'number', min: 0, placeholder: '0' },
      ];
      const form = UI.form(fields);

      /* Prefill on edit (UI.form has no initial-values option). */
      if (item) {
        const els = form.el.querySelectorAll('input, select');
        fields.forEach((f, i) => { els[i].value = item[f.name]; });
      }

      async function save() {
        const v = form.getValues();
        if (!v) return;
        try {
          if (item) await API.update('inventory', item.id, v);
          else await API.create('inventory', v);
          m.close();
          UI.toast(`Item "${v.name}" ${item ? 'updated' : 'added'}`, 'success');
          App.render();
        } catch (err) {
          UI.toast('Could not save item: ' + err.message, 'error');
        }
      }

      const body = UI.h('div', {}, [
        form.el,
        UI.h('div', { class: 'form-actions' }, [
          UI.h('button', { class: 'btn btn-primary', onclick: save }, item ? 'Save Changes' : 'Add Item'),
          UI.h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'),
        ]),
      ]);
      const m = UI.modal(item ? 'Edit Inventory Item' : 'New Inventory Item', body);
    }

    async function removeItem(item) {
      if (!UI.confirm(`Delete "${item.name}" from inventory? This cannot be undone.`)) return;
      try {
        await API.remove('inventory', item.id);
        UI.toast(`Item "${item.name}" deleted`, 'success');
        App.render();
      } catch (err) {
        UI.toast('Could not delete item: ' + err.message, 'error');
      }
    }

    function stockBadge(i) {
      if (!isLow(i)) return UI.badge('In Stock', 'ok');
      return UI.badge('Low Stock', +i.stock === 0 ? 'bad' : 'warn');
    }

    function buildColumns() {
      const columns = [
        { key: 'name', label: 'Item' },
        { key: 'category', label: 'Category', render: i => UI.badge(i.category, 'info') },
        { key: 'unit', label: 'Unit' },
        { key: 'stock', label: 'Stock', render: i => (+i.stock).toLocaleString() },
        { key: 'reorder_level', label: 'Reorder Level', render: i => (+i.reorder_level).toLocaleString() },
        { label: 'Stock Status', render: stockBadge },
      ];
      if (canEdit) {
        columns.push({
          label: 'Actions',
          render: i => UI.h('div', { class: 'row-actions' }, [
            UI.h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openItemForm(i) }, 'Edit'),
            UI.h('button', { class: 'btn btn-sm btn-danger', onclick: () => removeItem(i) }, 'Delete'),
          ]),
        });
      }
      return columns;
    }

    root.append(UI.h('div', { class: 'toolbar' }, [
      UI.h('input', {
        type: 'search', placeholder: 'Search items by name…',
        oninput: e => { query = e.target.value; refresh(); },
      }),
      UI.h('select', {
        onchange: e => { category = e.target.value; refresh(); },
      }, ['All', ...CATEGORIES].map(c =>
        UI.h('option', { value: c }, c === 'All' ? 'All categories' : c))),
      canEdit ? UI.h('button', { class: 'btn btn-primary', onclick: () => openItemForm(null) }, '+ Add Item') : null,
      countNote,
    ]));
    root.append(tableBox);
    refresh();

    return root;
  },
});
