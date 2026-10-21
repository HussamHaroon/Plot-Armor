/* ReliefHub API client — all reads/writes go through HTTP to the mock API.
 * API base can be overridden for local testing: index.html?api=http://localhost:3011 */
const API_BASE = new URLSearchParams(location.search).get('api') || 'http://localhost:3000';

const API = {
  async request(method, path, body) {
    const res = await fetch(API_BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
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
