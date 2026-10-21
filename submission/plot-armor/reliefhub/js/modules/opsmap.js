/* MODULE: Sindh Ops Map (OpenStreetMap + OSRM routed delivery paths) — OWNER: Eshaal (@Eshaal607)
 * Real map, real roads: camp markers sized by families and colored by fulfilment health,
 * delivery routes traced from the central warehouse along actual roads via the free OSRM
 * demo server (no API key). Falls back to straight dashed lines if the router is
 * unreachable. Read-only — works live and in demo mode. */
(() => {
  const COORDS = {
    Sukkur: [27.70, 68.85], Larkana: [27.56, 68.20], Khairpur: [27.30, 68.90],
    Nawabshah: [26.25, 68.40], Jamshoro: [25.43, 68.00], Hyderabad: [25.38, 68.37],
    Thatta: [24.75, 67.90], Badin: [24.65, 68.85],
  };
  const DEPOT = { name: 'Central Warehouse (Hyderabad)', at: [25.38, 68.37] };
  const HEALTH = { healthy: '#10b981', strained: '#d97706', critical: '#dc2626', neutral: '#34d399' };
  let map = null;
  let leafletReady = null;

  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletReady) return leafletReady;
    leafletReady = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
      document.head.append(css);
      const js = document.createElement('script');
      js.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
      js.onload = () => resolve(window.L);
      js.onerror = () => reject(new Error('leaflet failed to load'));
      document.head.append(js);
      setTimeout(() => reject(new Error('leaflet timed out')), 12000);
    });
    return leafletReady;
  }

  function healthOf(camp, needsByCamp) {
    const list = needsByCamp[camp.id] || [];
    if (!list.length) return 'neutral';
    const req = list.reduce((s, n) => s + (+n.required_quantity || 0), 0);
    const ful = list.reduce((s, n) => s + (+n.fulfilled_quantity || 0), 0);
    const pct = req ? (ful / req) * 100 : 100;
    return pct >= 60 ? 'healthy' : pct >= 30 ? 'strained' : 'critical';
  }

  async function routeTo(at) {
    const [dLat, dLon] = DEPOT.at;
    const [cLat, cLon] = at;
    const straight = { line: [DEPOT.at, at], km: null, min: null, approx: true };
    try {
      const url = 'https://router.project-osrm.org/route/v1/driving/' +
        dLon + ',' + dLat + ';' + cLon + ',' + cLat + '?overview=full&geometries=geojson';
      const res = await Promise.race([
        fetch(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('osrm timeout')), 15000)),
      ]);
      if (!res.ok) return straight;
      const data = await res.json();
      const route = data.routes && data.routes[0];
      if (!route) return straight;
      return {
        line: route.geometry.coordinates.map(c => [c[1], c[0]]),
        km: route.distance / 1000,
        min: route.duration / 60,
        approx: false,
      };
    } catch (err) {
      return straight;
    }
  }

  const mod = {
    id: 'opsmap', title: 'Ops Map', icon: '🗺️', order: 8,
    subtitle: 'Camp sites on OpenStreetMap with routed delivery paths from the warehouse',

    async render() {
      const [camps, needs] = await Promise.all([API.list('camps'), API.list('needs')]);
      const needsByCamp = {};
      for (const n of needs) (needsByCamp[n.camp_id] = needsByCamp[n.camp_id] || []).push(n);

      const root = UI.h('div');
      root.append(UI.h('div', { class: 'panel' }, [
        UI.h('h3', {}, 'Delivery routes — traced on the real road network'),
        UI.h('p', { class: 'muted' },
          'Routes from the central warehouse are traced via OSRM (Open Source Routing Machine) over OpenStreetMap data — dashed lines follow actual roads, not straight guesses. Map data © OpenStreetMap contributors.'),
      ]));
      const mapBox = UI.h('div', {
        id: 'opsmap-canvas',
        style: 'height:520px;border-radius:12px;border:1px solid #e2e8f0;z-index:0;',
      });
      const listBox = UI.h('div', { class: 'panel' }, [
        UI.h('h3', {}, 'Routes'),
        UI.h('p', { class: 'muted' }, 'Tracing routes…'),
      ]);
      root.append(mapBox, listBox);
      root.append(UI.h('div', { class: 'toolbar', style: 'margin-top:10px' }, [
        UI.badge('healthy 60%+', 'ok'),
        UI.badge('strained 30-59%', 'warn'),
        UI.badge('critical <30%', 'bad'),
        UI.badge('closed camp', 'muted'),
        UI.h('span', { class: 'muted' }, '· marker size = families sheltered'),
      ]));

      ensureLeaflet().then(L => {
        if (map) { map.remove(); map = null; }
        map = L.map(mapBox, { scrollWheelZoom: false }).setView([26.4, 68.4], 7);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© OpenStreetMap contributors · routing by OSRM',
        }).addTo(map);

        L.marker(DEPOT.at, { title: DEPOT.name })
          .addTo(map).bindPopup('<strong>' + DEPOT.name + '</strong><br>All routes start here.');

        const maxFam = Math.max(1, ...camps.map(c => +c.current_families || 0));
        const rows = camps.map(camp => {
          const at = COORDS[camp.district] || [26.4, 68.4];
          const closed = camp.status === 'Closed';
          const health = healthOf(camp, needsByCamp);
          const marker = L.circleMarker(at, {
            radius: 7 + 9 * ((+camp.current_families || 0) / maxFam),
            color: closed ? '#64748b' : HEALTH[health],
            fillColor: HEALTH[health],
            fillOpacity: closed ? 0.15 : 0.55,
            weight: 2,
          }).addTo(map);
          marker.bindPopup(
            '<strong>' + camp.name + '</strong> (' + camp.district + ')<br>' +
            camp.current_families + ' / ' + camp.capacity + ' families · ' + camp.status +
            '<br>Supply health: ' + health);
          marker.on('click', () => { location.hash = '#/camps'; });
          return { camp, at, closed };
        });

        (async () => {
          const listEl = UI.h('div');
          listBox.innerHTML = '';
          listBox.append(UI.h('h3', {}, 'Routes'), listEl);
          for (const row of rows) {
            if (row.closed) {
              listEl.append(UI.h('div', { class: 'muted', style: 'padding:4px 0' },
                '✕ ' + row.camp.name + ' — closed, no deliveries routed'));
              continue;
            }
            const r = await routeTo(row.at);
            L.polyline(r.line, {
              color: '#10b981', weight: 3, opacity: 0.75, dashArray: '7 9',
            }).addTo(map).bindTooltip(
              'Warehouse → ' + row.camp.name +
              (r.approx ? ' (approx.)' : ' · ' + r.km.toFixed(0) + ' km · ' + Math.round(r.min) + ' min'));
            listEl.append(UI.h('div', { style: 'padding:5px 0;font-size:13.5px' }, [
              UI.h('strong', {}, row.camp.name + ' '),
              r.approx
                ? UI.h('span', { class: 'muted' }, 'straight-line estimate (router unreachable)')
                : UI.h('span', {}, r.km.toFixed(0) + ' km · ~' + Math.round(r.min) + ' min by road'),
            ]));
          }
          listEl.append(UI.h('p', { class: 'muted', style: 'margin-top:8px' },
            'Route tracing: OSRM demo server over OpenStreetMap. Dashed = actual road path from the warehouse.'));
        })();
      }).catch(() => {
        mapBox.innerHTML = '<p class="empty">Map library could not load — check your connection.</p>';
      });

      return root;
    },
  };

  App.registerModule(mod);
})();
