const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-please',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 }
}));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID  = process.env.ADMIN_ID;

// ---------- Хранилище (JSON-файл) ----------
const DB_FILE = path.join(__dirname, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = { users: [], applications: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { users: [], applications: [] };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Создаём главного админа при первом запуске
(function ensureAdmin() {
  const db = loadDB();
  if (!db.users.find(u => u.role === 'admin')) {
    const login = process.env.ADMIN_LOGIN || 'admin';
    const pass  = process.env.ADMIN_PASSWORD || 'admin123';
    db.users.push({
      id: Date.now().toString(),
      login,
      passwordHash: bcrypt.hashSync(pass, 10),
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    saveDB(db);
    console.log(`✅ Создан главный админ: ${login} / ${pass}`);
  }
})();

const TERMS = {
  '1h':  '1 час',
  '3h':  '3 часа',
  '6h':  '6 часов',
  '12h': '12 часов',
  '1d':  '1 день',
  '2d':  '2 дня',
  '3d':  '3 дня',
  '5d':  '5 дней',
  '7d':  '7 дней'
};

// ---------- Регистрация / вход ----------
app.post('/api/register', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Заполните поля' });
  if (login.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });

  const db = loadDB();
  if (db.users.find(u => u.login === login)) {
    return res.status(400).json({ error: 'Логин занят' });
  }
  const user = {
    id: Date.now().toString(),
    login,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'user',
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);

  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ ok: true, login: user.login, role: user.role });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.login === login);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ ok: true, login: user.login, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ id: user.id, login: user.login, role: user.role });
});

// ---------- Заявки ----------
app.post('/api/apply', (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Сначала войдите в аккаунт' });
  }
  next();
}, async (req, res) => {
  const { name, amount, term } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);

  if (!name || !amount || !term) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  if (amount < 1 || amount > 1_000_000) {
    return res.status(400).json({ error: 'Сумма звёзд вне диапазона (1–1 000 000)' });
  }
  if (!TERMS[term]) {
    return res.status(400).json({ error: 'Недопустимый срок' });
  }

  const application = {
    id: Date.now().toString(),
    userId: user.id,
    userLogin: user.login,
    name,
    amount: Number(amount),
    term,
    termText: TERMS[term],
    status: 'new',
    createdAt: new Date().toISOString()
  };
  db.applications.push(application);
  saveDB(db);

  // Уведомление в Telegram
  if (BOT_TOKEN && ADMIN_ID) {
    const text =
      `⭐ Новая заявка на кредит в звёздах\n\n` +
      `👤 Имя: ${name}\n` +
      `🔑 Логин: ${user.login}\n` +
      `⭐ Сумма: ${amount} звёзд\n` +
      `⏱ Срок: ${TERMS[term]}`;
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_ID, text })
      });
    } catch (e) {
      console.error('Telegram error:', e.message);
    }
  }

  res.json({ ok: true });
});

// Мои заявки
app.get('/api/my-applications', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
  const db = loadDB();
  const list = db.applications.filter(a => a.userId === req.session.userId);
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// Все заявки (только админ)
app.get('/api/admin/applications', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  const db = loadDB();
  res.json(db.applications.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// Сменить статус заявки (админ)
app.post('/api/admin/applications/:id/status', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  const { status } = req.body;
  const allowed = ['new', 'approved', 'rejected'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' });

  const db = loadDB();
  const app_ = db.applications.find(a => a.id === req.params.id);
  if (!app_) return res.status(404).json({ error: 'Заявка не найдена' });
  app_.status = status;
  saveDB(db);
  res.json({ ok: true });
});

// Список пользователей (только админ)
app.get('/api/admin/users', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  const db = loadDB();
  res.json(db.users.map(u => ({
    id: u.id, login: u.login, role: u.role, createdAt: u.createdAt
  })));
});

app.get('/health', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
