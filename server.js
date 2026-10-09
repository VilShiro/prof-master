const express = require('express');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const db = new DatabaseSync('app.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS configs(user_id INTEGER PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, data TEXT NOT NULL, total INTEGER NOT NULL);
`);

const models = {
  S: { name: 'Aster S (седан)', price: 3200000 },
  X: { name: 'Aster X (кроссовер)', price: 4100000 },
  E: { name: 'Aster E (электро)', price: 5300000 },
};
const trims = {
  comfort: { name: 'Comfort', price: 0, rank: 0 },
  sport: { name: 'Sport', price: 300000, rank: 1 },
  premium: { name: 'Premium', price: 650000, rank: 2 },
};
const colors = {
  white: { name: 'Белый', hex: '#e9e9e6', price: 0 },
  blue: { name: 'Синий', hex: '#254a9a', price: 45000 },
  black: { name: 'Графит', hex: '#33363c', price: 45000 },
  red: { name: 'Красный', hex: '#b3202f', price: 80000, minTrim: 'sport' },
};
const options = {
  roof: { name: 'Панорамная крыша', price: 120000, minTrim: 'sport' },
  leather: { name: 'Кожаный салон', price: 150000, minTrim: 'premium', conflicts: ['sportseat'] },
  sportseat: { name: 'Спорт-сиденья', price: 110000, minTrim: 'sport', conflicts: ['leather'] },
  wheels: { name: 'Диски 20"', price: 95000, minTrim: 'sport', conflicts: ['tow'] },
  tow: { name: 'Фаркоп', price: 60000, models: ['X'], conflicts: ['wheels'] },
  charger: { name: 'Зарядная станция 11 кВт', price: 75000, models: ['E'] },
};

const why = (item, c) => {
  if (item.minTrim && trims[c.trim].rank < trims[item.minTrim].rank)
    return `Нужна комплектация ${trims[item.minTrim].name} или выше`;
  if (item.models && !item.models.includes(c.model))
    return `Только для ${item.models.map((m) => models[m].name).join(', ')}`;
  const x = (item.conflicts || []).find((o) => c.options.includes(o));
  if (x) return `Несовместимо с опцией «${options[x].name}» — сначала снимите её`;
  return null;
};

const quote = (b = {}) => {
  const c = {
    model: models[b.model] ? b.model : 'S',
    trim: trims[b.trim] ? b.trim : 'comfort',
    color: colors[b.color] ? b.color : 'white',
    options: [],
  };
  const removed = [];
  const cr = why(colors[c.color], c);
  if (cr) { removed.push(`Цвет «${colors[c.color].name}» снят: ${cr}`); c.color = 'white'; }
  for (const id of new Set(b.options || [])) {
    if (!options[id]) continue;
    const r = why(options[id], c);
    if (r) removed.push(`Опция «${options[id].name}» снята: ${r}`);
    else c.options.push(id);
  }
  const disabled = { colors: {}, options: {} };
  for (const id in colors) disabled.colors[id] = why(colors[id], c);
  for (const id in options) if (!c.options.includes(id)) disabled.options[id] = why(options[id], c);

  const lines = [
    { name: models[c.model].name, price: models[c.model].price },
    { name: `Комплектация ${trims[c.trim].name}`, price: trims[c.trim].price },
    { name: `Цвет: ${colors[c.color].name}`, price: colors[c.color].price },
    ...c.options.map((i) => ({ name: options[i].name, price: options[i].price })),
  ];
  return { config: c, lines, total: lines.reduce((s, l) => s + l.price, 0), removed, disabled };
};

const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const getToken = (req) => /(?:^|; )token=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];

app.use((req, res, next) => {
  const t = getToken(req);
  req.user = t
    ? db.prepare('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(t)
    : null;
  next();
});

const login = (res, userId) => {
  const t = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?, ?)').run(t, userId);
  res.setHeader('Set-Cookie', `token=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
};
const need = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Войдите или зарегистрируйтесь' });

app.post('/api/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 6)
    return res.status(400).json({ error: 'Введите email и пароль не короче 6 символов' });
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const r = db.prepare('INSERT INTO users(email, salt, hash) VALUES(?, ?, ?)').run(email, salt, hash(password, salt));
    login(res, Number(r.lastInsertRowid));
    res.json({ email });
  } catch {
    res.status(409).json({ error: 'Этот email уже зарегистрирован' });
  }
});

app.post('/api/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = u && crypto.timingSafeEqual(Buffer.from(hash(password, u.salt)), Buffer.from(u.hash));
  if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
  login(res, u.id);
  res.json({ email });
});

app.post('/api/logout', (req, res) => {
  const t = getToken(req);
  if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  res.setHeader('Set-Cookie', 'token=; Path=/; Max-Age=0');
  res.json({});
});

app.get('/api/catalog', (req, res) => res.json({ models, trims, colors, options }));
app.post('/api/quote', (req, res) => res.json(quote(req.body)));

app.get('/api/me', (req, res) => {
  const row = req.user && db.prepare('SELECT data FROM configs WHERE user_id = ?').get(req.user.id);
  res.json({ user: req.user ? req.user.email : null, config: row ? JSON.parse(row.data) : null });
});

app.put('/api/config', need, (req, res) => {
  db.prepare('INSERT INTO configs(user_id, data) VALUES(?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data')
    .run(req.user.id, JSON.stringify(quote(req.body).config));
  res.json({});
});

app.post('/api/order', need, (req, res) => {
  const q = quote(req.body);
  if (q.removed.length) return res.status(409).json({ error: q.removed.join('. ') });
  const r = db.prepare('INSERT INTO orders(user_id, data, total) VALUES(?, ?, ?)').run(req.user.id, JSON.stringify(q.config), q.total);
  res.json({ id: 'AST-' + (1000 + Number(r.lastInsertRowid)), total: q.total });
});

app.listen(3000, () => console.log('http://localhost:3000'));
