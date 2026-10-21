/* MODULE: Volunteers (Milestone 4, part B) — OWNER: Syeda Anusha Ali (@SyedaAnushaAli)
 *
 * Rules from the issue:
 *  - Register volunteers: name + skill. Skills are exactly:
 *    Medical, Logistics, Cooking, Driving, Counselling.
 *  - Search by name and filter by skill.
 *  - Assign / unassign volunteers to camps:
 *      * A volunteer may hold only ONE assignment at a time (camp_id is single).
 *      * Cannot be assigned to a Closed camp (validate against camp status).
 *  - Show assigned camp name in the list; badge or icon for assigned/available.
 *  - Coordinator-only mutations (App.canEdit()); volunteers read-only.
 */
(() => {
  if (!document.getElementById('anusha-css')) {
    const link = document.createElement('link');
    link.id = 'anusha-css';
    link.rel = 'stylesheet';
    link.href = 'js/modules/anusha.css';
    document.head.append(link);
  }

  const SKILLS = ['Medical', 'Logistics', 'Cooking', 'Driving', 'Counselling'];
  let searchQuery = '';
  let skillFilter = 'All';

  const mod = {
    id: 'volunteers', title: 'Volunteers', icon: '🤝', order: 6,
    subtitle: 'Skills registry and camp assignments',

    async render() {
      const [volunteers, camps] = await Promise.all([
        API.list('volunteers'), API.list('camps'),
      ]);
      const campById = Object.fromEntries(camps.map(c => [c.id, c]));

      const root = UI.h('div');

      /* live search + skill filter (no full re-render, keeps input focus) */
      const searchInput = UI.h('input', { type: 'text', placeholder: 'Search by name…', value: searchQuery });
      const skillSelect = UI.h('select', {}, ['All', ...SKILLS].map(s => {
        const opt = UI.h('option', { value: s }, s === 'All' ? 'All Skills' : s);
        opt.selected = s === skillFilter;
        return opt;
      }));
      const tableBox = UI.h('div');

      function visibleRows() {
        const q = searchQuery.trim().toLowerCase();
        return volunteers
          .filter(v => (!q || v.name.toLowerCase().includes(q)))
          .filter(v => skillFilter === 'All' || v.skill === skillFilter)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
      }

      function drawTable() {
        tableBox.innerHTML = '';
        const rows = visibleRows();
        const columns = [
          { label: 'Name', render: v => UI.h('strong', {}, v.name) },
          { label: 'Skill', render: v => UI.badge(v.skill, 'info') },
          { label: 'Assigned Camp', render: v => {
              const camp = campById[v.camp_id];
              if (!camp) return UI.h('span', { class: 'muted' }, '—');
              return camp.name + (camp.status === 'Closed' ? ' (Closed)' : '');
            } },
          { label: 'Status', render: v => v.camp_id != null
              ? UI.badge('Assigned', 'ok')
              : UI.badge('Available', 'muted') },
        ];
        if (App.canEdit()) {
          columns.push({ label: 'Actions', render: v => UI.h('span', { class: 'row-actions' }, [
            UI.h('button', { class: 'btn btn-sm btn-primary', onclick: () => mod.openAssign(v) },
              v.camp_id != null ? 'Reassign' : 'Assign'),
            v.camp_id != null
              ? UI.h('button', { class: 'btn btn-sm btn-danger', onclick: () => mod.unassign(v) }, 'Unassign')
              : null,
          ]) });
        }
        tableBox.append(UI.h('div', { class: 'panel' }, [
          UI.h('h3', {}, `Volunteers (${rows.length})`),
          UI.table(columns, rows, 'No volunteers match your search.'),
        ]));
      }

      searchInput.addEventListener('input', () => { searchQuery = searchInput.value; drawTable(); });
      skillSelect.addEventListener('change', () => { skillFilter = skillSelect.value; drawTable(); });
      drawTable();

      root.append(UI.h('div', { class: 'toolbar' }, [
        searchInput,
        skillSelect,
        App.canEdit()
          ? UI.h('button', { class: 'btn btn-primary', onclick: () => mod.openRegister() }, '+ Register Volunteer')
          : null,
      ]));
      root.append(tableBox);

      return root;
    },

    /* ---------- assignment: one camp at a time, never a Closed camp ---------- */
    async openAssign(volunteer) {
      let camps;
      try { camps = await API.list('camps'); }
      catch (err) { UI.toast('Could not load camps: ' + err.message, 'error'); return; }

      /* closed camps can't take volunteers — keep them out of the picker */
      const openCamps = camps.filter(c => c.status !== 'Closed');
      if (!openCamps.length) {
        UI.toast('No open camps available for assignment', 'error');
        return;
      }

      const campSelect = UI.h('select', {}, openCamps.map(c =>
        UI.h('option', { value: String(c.id) }, `${c.name} (${c.district}) — ${c.status}`)));
      if (volunteer.camp_id != null) {
        const current = openCamps.find(c => c.id === volunteer.camp_id);
        if (current) campSelect.value = String(current.id); /* preselect current camp for reassignment */
      }
      const note = UI.h('p', { class: 'hint' },
        `${volunteer.name} can only hold one camp assignment — assigning moves them from their current camp. Closed camps are not listed.`);

      const { close } = UI.modal(`Assign ${volunteer.name}`, UI.h('div', {}, [
        UI.h('div', { class: 'form' }, [
          UI.h('label', { class: 'field' }, [UI.h('span', {}, 'Camp'), campSelect]),
        ]),
        note,
        UI.h('div', { class: 'form-actions' }, [
          UI.h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel'),
          UI.h('button', { class: 'btn btn-primary', onclick: async () => {
              const camp = camps.find(c => c.id === +campSelect.value);
              if (!camp) { UI.toast('Pick a camp first', 'error'); return; }
              if (camp.status === 'Closed') { UI.toast('Cannot assign a volunteer to a Closed camp', 'error'); return; }
              try {
                /* camp_id is a single field, so this replaces any previous assignment */
                await API.update('volunteers', volunteer.id, { camp_id: camp.id });
                UI.toast(`${volunteer.name} assigned to ${camp.name}`, 'success');
                close();
                App.render();
              } catch (err) {
                UI.toast('Could not assign volunteer: ' + err.message, 'error');
              }
            } }, 'Assign'),
        ]),
      ]));
    },

    async unassign(volunteer) {
      if (volunteer.camp_id == null) return;
      if (!UI.confirm(`Unassign ${volunteer.name} from their camp? They will be marked available.`)) return;
      try {
        await API.update('volunteers', volunteer.id, { camp_id: null });
        UI.toast(`${volunteer.name} is now available`, 'success');
        App.render();
      } catch (err) {
        UI.toast('Could not unassign volunteer: ' + err.message, 'error');
      }
    },

    /* ---------- register: name + one of the five fixed skills ---------- */
    openRegister() {
      const form = UI.form([
        { name: 'name', label: 'Full Name', placeholder: 'e.g. Ayesha Siddiqui' },
        { name: 'skill', label: 'Skill', options: SKILLS },
      ]);
      const { close } = UI.modal('Register Volunteer', UI.h('div', {}, [
        form.el,
        UI.h('div', { class: 'form-actions' }, [
          UI.h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel'),
          UI.h('button', { class: 'btn btn-primary', onclick: async () => {
              const values = form.getValues();
              if (!values) return;
              try {
                await API.create('volunteers', { name: values.name, skill: values.skill, camp_id: null });
                UI.toast(`${values.name} registered as a ${values.skill} volunteer`, 'success');
                close();
                App.render();
              } catch (err) {
                UI.toast('Could not register volunteer: ' + err.message, 'error');
              }
            } }, 'Register'),
        ]),
      ]));
    },
  };

  App.registerModule(mod);
})();
