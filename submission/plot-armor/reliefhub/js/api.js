/* ReliefHub API client — all reads/writes go through HTTP to the mock API.
 * API base can be overridden for local testing: index.html?api=http://localhost:3011
 * Demo mode: when no API server is reachable (e.g. the static GitHub Pages
 * deployment), GET requests fall back to the bundled seed file
 * api-server/db.json so the whole app stays browsable read-only. */
const API_BASE = new URLSearchParams(location.search).get('api') || 'http://localhost:3000';

const API = {
  _demoMode: false,
  _demoDb: null,

  async request(method, path, body) {
    if (this._demoMode) return this._demoRequest(method, path);
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      /* free-tier hosts sleep when idle - first request wakes them (10-30s).
       * retry once before giving up, then fall back to bundled demo data. */
      if (method === 'GET' && !this._wokeRetry) {
        this._wokeRetry = true;
        if (typeof UI !== 'undefined' && UI.toast) {
          UI.toast('API is waking up, trying again in a few seconds…', 'info');
        }
        await new Promise(r => setTimeout(r, 9000));
        return this.request(method, path, body);
      }
      /* server unreachable -> switch to bundled demo data for reads */
      if (method === 'GET') {
        this._demoMode = true;
        return this._demoRequest(method, path);
      }
      throw networkErr;
    }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
  },

  async _demoRequest(method, path) {
    if (!this._demoDb) {
      const res = await fetch('api-server/db.json');
      if (!res.ok) throw new Error('demo data unavailable');
      this._demoDb = await res.json();
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast('API offline — browsing bundled demo data (read-only)', 'info');
      }
    }
    const [p, q] = path.split('?');
    const parts = p.split('/').filter(Boolean);
    const coll = this._demoDb[parts[0]];
    if (coll === undefined) throw new Error(`unknown collection ${parts[0]}`);
    if (method === 'GET') {
      if (parts[1]) {
        const row = coll.find(r => String(r.id) === parts[1]);
        if (!row) throw new Error(`GET ${path} -> 404`);
        return row;
      }
      let rows = coll;
      if (q) {
        for (const [k, v] of new URLSearchParams(q)) {
          rows = rows.filter(r => String(r[k]) === v);
        }
      }
      return rows;
    }
    throw new Error('read-only demo mode — start the local API server to make changes');
  },

  list(coll, params) {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/${coll}${q}`);
  },
  get(coll, id) { return this.request('GET', `/${coll}/${id}`); },
  create(coll, data) { return this.request('POST', `/${coll}`, data); },
  update(coll, id, data) { return this.request('PATCH', `/${coll}/${id}`, data); },
  remove(coll, id) { return this.request('DELETE', `/${coll}/${id}`); },
};
