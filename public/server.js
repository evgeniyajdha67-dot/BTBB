const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID  = process.env.ADMIN_ID;

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

app.post('/api/apply', async (req, res) => {
  const { tg, name, amount, term } = req.body;

  if (!tg || !name || !amount || !term) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  if (amount < 1000 || amount > 5_000_000) {
    return res.status(400).json({ error: 'Сумма вне допустимого диапазона' });
  }
  if (!TERMS[term]) {
    return res.status(400).json({ error: 'Недопустимый срок' });
  }

  const text =
    `📄 Новая заявка на кредит\n\n` +
    `👤 Имя: ${name}\n` +
    `✈️ Telegram: ${tg}\n` +
    `💰 Сумма: ${amount} ₽\n` +
    `⏱ Срок: ${TERMS[term]}`;

  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_ID, text })
    });
    if (!r.ok) throw new Error('Telegram API error');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось отправить заявку' });
  }
});

// healthcheck (чтобы Render не ругался)
app.get('/health', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
