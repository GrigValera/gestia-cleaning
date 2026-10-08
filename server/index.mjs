import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8787);
const allowedOrigin = process.env.ALLOWED_ORIGIN || '';
const providers = [
  ['CRM', process.env.CRM_WEBHOOK_URL, process.env.CRM_BEARER_TOKEN],
  ['email', process.env.EMAIL_WEBHOOK_URL, process.env.EMAIL_BEARER_TOKEN],
  ['SMS', process.env.SMS_WEBHOOK_URL, process.env.SMS_BEARER_TOKEN]
].filter(([, url]) => url);
const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
const hits = new Map();

function validLead(lead) {
  if (!lead || typeof lead !== 'object' || Array.isArray(lead)) return false;
  const text = key => typeof lead[key] === 'string';
  if (!text('name') || !text('phone') || !text('service')) return false;
  if (!lead.name.trim() || !lead.service.trim() || lead.phone.replace(/\D/g, '').length < 10) return false;
  if (lead.name.length > 80 || lead.phone.length > 40 || lead.service.length > 100 || lead.consent !== true) return false;
  if (lead.website) return false;
  for (const [key, max] of [['location', 180], ['comment', 1000], ['email', 200], ['area', 6], ['date', 10]]) {
    if (lead[key] != null && (!text(key) || lead[key].length > max)) return false;
  }
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return false;
  if (lead.contactMethod === 'email' && !lead.email) return false;
  return true;
}

function leadText(lead) {
  return [
    'Новая заявка — Гестия',
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    `Услуга: ${lead.service}`,
    lead.area && `Площадь: ${lead.area} м²`,
    lead.date && `Дата: ${lead.date}`,
    lead.location && `Район/адрес: ${lead.location}`,
    lead.comment && `Комментарий: ${lead.comment}`,
    lead.contactMethod && `Способ связи: ${lead.contactMethod}`,
    lead.email && `Email: ${lead.email}`
  ].filter(Boolean).join('\n');
}

async function dispatch(lead) {
  const jobs = providers.map(async ([name, url, token]) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ source: 'gestia-website', receivedAt: new Date().toISOString(), ...lead }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return name;
  });
  if (telegramConfigured) jobs.push((async () => {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: leadText(lead) }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Telegram: HTTP ${response.status}`);
    return 'Telegram';
  })());
  return Promise.allSettled(jobs);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (allowedOrigin && origin === allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  headers['Vary'] = 'Origin';
  const send = (status, data) => { res.writeHead(status, headers); res.end(JSON.stringify(data)); };

  if (req.url === '/health' && req.method === 'GET') return send(200, { ok: true });
  if (req.url !== '/api/leads') return send(404, { error: 'Not found' });
  if (req.method === 'OPTIONS') {
    if (allowedOrigin && origin !== allowedOrigin) return send(403, { error: 'Origin denied' });
    res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method !== 'POST') return send(405, { error: 'Method not allowed' });
  if (!allowedOrigin || origin !== allowedOrigin) return send(403, { error: 'Origin denied' });
  if (!providers.length && !telegramConfigured) return send(503, { error: 'No delivery channel configured' });

  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(time => now - time < 60_000);
  if (recent.length >= 5) return send(429, { error: 'Too many requests' });
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 10_000) for (const [key, values] of hits) if (values.every(time => now - time >= 60_000)) hits.delete(key);

  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 12_000) return send(413, { error: 'Request too large' });
    }
    const lead = JSON.parse(body);
    if (!validLead(lead)) return send(400, { error: 'Invalid lead' });
    const result = await dispatch(lead);
    const failures = result.filter(item => item.status === 'rejected');
    if (failures.length) {
      console.error('Lead delivery failed:', failures.map(item => item.reason?.message || 'unknown'));
      return send(502, { error: 'Delivery failed' });
    }
    send(200, { ok: true });
  } catch (error) {
    console.error('Lead request failed:', error.message);
    send(400, { error: 'Invalid request' });
  }
});

server.listen(port, () => console.log(`Gestia adapter listening on port ${port}`));
