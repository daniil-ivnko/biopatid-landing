// =============================================================
//  Biopatid — приём заявок с сайта и пересылка в Telegram-группу
//  Vercel Serverless Function.  Endpoint: POST /api/lead
//
//  Переменные окружения (Vercel → Settings → Environment Variables):
//    TELEGRAM_BOT_TOKEN  — токен бота от @BotFather
//    TELEGRAM_CHAT_ID    — id группы менеджеров (например -1001234567890)
// =============================================================

const TELEGRAM_API = 'https://api.telegram.org/bot';

// --- экранирование для Telegram HTML parse_mode --------------
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- обрезка строк, чтобы не прилетал «роман» от спам-ботов ---
function clip(value, max) {
  const s = String(value == null ? '' : value).trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// --- метка времени по Киеву ----------------------------------
function kyivStamp() {
  try {
    return new Date().toLocaleString('uk-UA', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return new Date().toISOString();
  }
}

// --- сборка текста заявки на заказ ----------------------------
function buildOrderMessage(d) {
  const lines = [];
  lines.push('<b>🆕 НОВА ЗАЯВКА · Замовлення</b>');
  lines.push('');
  if (d.product) lines.push('<b>Товар:</b> ' + esc(clip(d.product, 120)));
  if (d.qty)     lines.push('<b>Кількість:</b> ' + esc(clip(d.qty, 10)));
  if (d.total)   lines.push('<b>Орієнтовна сума:</b> ' + esc(clip(d.total, 40)));
  lines.push('');
  lines.push('<b>Клієнт:</b> ' + esc(clip((d.firstName || '') + ' ' + (d.lastName || ''), 160)));
  lines.push('<b>Телефон:</b> ' + esc(clip(d.phone, 40)));
  if (d.city)      lines.push('<b>Місто:</b> ' + esc(clip(d.city, 120)));
  if (d.warehouse) lines.push('<b>Відділення Нової Пошти:</b> ' + esc(clip(d.warehouse, 120)));
  if (d.comment)   lines.push('<b>Коментар:</b> ' + esc(clip(d.comment, 600)));
  lines.push('');
  lines.push('<i>Джерело: блок «Продукт» · ' + esc(kyivStamp()) + '</i>');
  return lines.join('\n');
}

// --- сборка текста заявки с квиза -----------------------------
function buildQuizMessage(d) {
  const lines = [];
  lines.push('<b>🧭 НОВА ЗАЯВКА · Квіз</b>');
  lines.push('');
  lines.push('<b>Клієнт:</b> ' + esc(clip((d.firstName || '') + ' ' + (d.lastName || ''), 160)));
  lines.push('<b>Телефон:</b> ' + esc(clip(d.phone, 40)));
  lines.push('');
  lines.push('<b>Відповіді квіза:</b>');
  if (d.goal)     lines.push('• <b>Мета:</b> ' + esc(clip(d.goal, 200)));
  if (d.exp)      lines.push('• <b>Досвід:</b> ' + esc(clip(d.exp, 200)));
  if (d.obstacle) lines.push('• <b>Перешкода:</b> ' + esc(clip(d.obstacle, 200)));
  if (d.forecast) lines.push('• <b>Прогноз:</b> ' + esc(clip(d.forecast, 80)));
  lines.push('');
  lines.push('<i>Задача менеджера: допомогти з вибором курсу та оформити замовлення.</i>');
  lines.push('<i>Джерело: квіз · ' + esc(kyivStamp()) + '</i>');
  return lines.join('\n');
}

module.exports = async (req, res) => {
  // --- принимаем только POST ---------------------------------
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // --- парсим тело -------------------------------------------
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  // --- honeypot: скрытое поле должно быть пустым -------------
  // если бот заполнил «company» — отвечаем «успех», но ничего не шлём
  if (body.company) {
    return res.status(200).json({ ok: true });
  }

  // --- проверка конфигурации ---------------------------------
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return res.status(500).json({ ok: false, error: 'Server is not configured' });
  }

  // --- валидация ---------------------------------------------
  const type = body.type === 'quiz' ? 'quiz' : 'order';
  const phone = String(body.phone || '').trim();
  const firstName = String(body.firstName || '').trim();

  if (!firstName) {
    return res.status(400).json({ ok: false, error: 'Вкажіть імʼя' });
  }
  // в номере должно быть хотя бы 9 цифр
  if ((phone.match(/\d/g) || []).length < 9) {
    return res.status(400).json({ ok: false, error: 'Вкажіть коректний номер телефону' });
  }

  const text = type === 'quiz' ? buildQuizMessage(body) : buildOrderMessage(body);

  // --- отправка в Telegram -----------------------------------
  try {
    const tgRes = await fetch(TELEGRAM_API + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const tgData = await tgRes.json();
    if (!tgData.ok) {
      console.error('Telegram API error:', tgData);
      return res.status(502).json({ ok: false, error: 'Не вдалося надіслати заявку' });
    }
  } catch (err) {
    console.error('Telegram request failed:', err);
    return res.status(502).json({ ok: false, error: 'Не вдалося надіслати заявку' });
  }

  return res.status(200).json({ ok: true });
};
