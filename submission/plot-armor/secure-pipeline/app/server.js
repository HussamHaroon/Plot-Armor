// reliefhub camp status api
// sample app for our devsecops pipeline demo (issue #2)
// plain node + express, no build step, dummy data only
// remediated after the security gate flagged the demo vulnerabilities

const express = require('express');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const _ = require('lodash');
const { query } = require('./db');

const app = express();
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.json());

// dummy camp data so the api has something to serve
const camps = [
  { id: 1, name: 'Riverside Relief Camp', zone: 'north', capacity: 250, occupants: 198, status: 'operational' },
  { id: 2, name: 'Hilltop Shelter', zone: 'south', capacity: 120, occupants: 121, status: 'over-capacity' },
  { id: 3, name: 'Central Medical Camp', zone: 'east', capacity: 400, occupants: 265, status: 'operational' },
  { id: 4, name: 'Lakeside Emergency Camp', zone: 'west', capacity: 180, occupants: 44, status: 'winding-down' },
];

// health endpoint - the pipeline smoke test hits this
app.get('/', (req, res) => {
  res.json({ app: 'reliefhub camp status api', status: 'ok', uptime: process.uptime() });
});

// overall camp status summary
app.get('/api/status', (req, res) => {
  const totalCapacity = _.sumBy(camps, 'capacity');
  const totalOccupants = _.sumBy(camps, 'occupants');
  res.json({
    ok: true,
    camps: camps.length,
    totalCapacity,
    totalOccupants,
    utilization: `${Math.round((totalOccupants / totalCapacity) * 100)}%`,
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });
});

// remediated: small recursive-descent arithmetic parser replaces eval()
// only digits and + - * / ( ) . are accepted, so no code execution is possible
function evaluateExpression(input) {
  const s = String(input).replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(s)) throw new Error('invalid characters');
  let pos = 0;
  function parseExpr() {
    let v = parseTerm();
    while (s[pos] === '+' || s[pos] === '-') {
      const op = s[pos++];
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (s[pos] === '*' || s[pos] === '/') {
      const op = s[pos++];
      const r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    if (s[pos] === '(') {
      pos++;
      const v = parseExpr();
      if (s[pos] !== ')') throw new Error('mismatched parentheses');
      pos++;
      return v;
    }
    if (s[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    const start = pos;
    while (pos < s.length && /[0-9.]/.test(s[pos])) pos++;
    if (start === pos) throw new Error('expected a number');
    return Number(s.slice(start, pos));
  }
  const result = parseExpr();
  if (pos !== s.length) throw new Error('unexpected trailing input');
  if (!Number.isFinite(result)) throw new Error('result is not finite');
  return result;
}

app.get('/api/calc', (req, res) => {
  const expr = req.query.expr || '0';
  try {
    const result = evaluateExpression(expr);
    res.json({ expr, result });
  } catch (err) {
    res.status(400).json({ error: 'invalid expression' });
  }
});

// camp lookup by id - goes through the mock db layer
// remediated: parameterized query, the id is bound as data and never spliced into sql
app.get('/api/camps/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid camp id' });
  }
  const rows = await query('SELECT * FROM camps WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'camp not found' });
  }
  res.json(rows[0]);
});

// camp search by name - parameterized the same way
app.get('/api/camps', async (req, res) => {
  const name = req.query.name || '';
  const rows = await query("SELECT * FROM camps WHERE name LIKE '%' || ? || '%'", [String(name)]);
  res.json(rows);
});

// remediated twice over: md5 -> sha256 -> scrypt with a random salt.
// scrypt is node's stdlib memory-hard KDF, the right tool for passwords -
// a plain digest (even sha256) is not a password hash.
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return { algorithm: 'scrypt', salt, hash };
}

// demo route showing the hash helper in action (hashes whatever word you post)
app.post('/api/hash-password', (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }
  res.json(hashPassword(password));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`camp status api listening on port ${PORT}`);
});
