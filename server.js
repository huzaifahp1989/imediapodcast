const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { put } = require('@vercel/blob');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const expressLayouts = require('express-ejs-layouts');
const https = require('https');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('change_me', 10);

const limiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use(helmet());
app.use(limiter);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => { res.locals.currentPath = req.path; next(); });
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
const uploadsDir = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(publicDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

const memory = multer.memoryStorage();
const disk = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadsDir); },
  filename: function (req, file, cb) {
    const id = uuidv4();
    const ext = path.extname(file.originalname || '');
    const nameSafe = (req.body.title || file.originalname || 'file').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    cb(null, `${id}-${nameSafe}${ext}`);
  }
});
const upload = multer({
  storage: process.env.VERCEL && (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_TOKEN) ? memory : disk,
  limits: { fileSize: 1024 * 1024 * 200 },
  fileFilter: (req, file, cb) => {
    const ok = ['audio/', 'video/'].some(p => file.mimetype.startsWith(p));
    cb(null, ok);
  }
});

function requireAdmin(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (e) {
    return res.redirect('/admin/login');
  }
}

app.get('/', async (req, res) => {
  const latest = await db.listRecordings({ status: 'Approved', limit: 10 });
  const streams = await db.listStreams('Active');
  res.render('home', { latest, streams });
});

app.get('/record', (req, res) => {
  res.render('record');
});

app.get('/library', (req, res) => {
  const { q, category, type, sort } = req.query;
  const items = db.searchLibrary({ q, category, type, sort, status: 'Approved' });
  res.render('library', { items, q: q || '', category: category || 'All', type: type || 'All', sort: sort || 'latest' });
});

app.get('/requests', (req, res) => {
  const featured = db.listFeatured('requests');
  res.render('requests', { featured });
});

app.get('/live', async (req, res) => {
  const streams = await db.listStreams('Active');
  res.render('live', { streams });
});

function renderSingleStream(res, s) {
  if (!s) return res.status(404).send('Stream not found');
  res.render('live_single', { stream: s });
}

app.get('/haramainlive', async (req, res) => {
  const list = await db.listStreams('Active');
  const s = list.find(x => /haramain|makkah|mecca/i.test(x.title));
  renderSingleStream(res, s);
});

app.get('/madinahlive', async (req, res) => {
  const list = await db.listStreams('Active');
  const s = list.find(x => /madinah|medina/i.test(x.title));
  renderSingleStream(res, s);
});

app.post('/api/recordings', upload.single('media'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });
  const { fullName, email, title, category, description, durationMs, source } = req.body;
  if (!fullName || !title || !category) return res.status(400).json({ error: 'Missing fields' });
  const id = uuidv4();
  let fileUrl;
  if (req.file.buffer && (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_TOKEN)) {
    const ext = file.mimetype.startsWith('video/') ? '.mp4' : '.wav';
    const nameSafe = (title || 'recording').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    const blob = await put(`${id}-${nameSafe}${ext}`, file.buffer, { access: 'public', contentType: file.mimetype, token: process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_TOKEN });
    fileUrl = blob.url;
  } else {
    fileUrl = `/uploads/${file.filename}`;
  }
  await db.insertRecording({
    id,
    title,
    name: fullName,
    email: email || null,
    category,
    description: description || '',
    file_url: fileUrl,
    type: file.mimetype.startsWith('video/') ? 'video' : 'audio',
    status: 'Pending',
    created_at: dayjs().toISOString(),
    duration_ms: durationMs ? Number(durationMs) : null,
    source: source || 'record'
  });
  res.json({ ok: true, id });
});

app.post('/api/upload', upload.single('media'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send('No file');
  const { fullName, email, title, category, description } = req.body;
  if (!fullName || !title || !category) return res.status(400).send('Missing fields');
  const id = uuidv4();
  let fileUrl;
  if (req.file.buffer && (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_TOKEN)) {
    const ext = path.extname(file.originalname || '') || (file.mimetype.startsWith('video/') ? '.mp4' : '.wav');
    const nameSafe = (title || file.originalname || 'file').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    const blob = await put(`${id}-${nameSafe}${ext}`, file.buffer, { access: 'public', contentType: file.mimetype, token: process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_TOKEN });
    fileUrl = blob.url;
  } else {
    fileUrl = `/uploads/${file.filename}`;
  }
  await db.insertRecording({
    id,
    title,
    name: fullName,
    email: email || null,
    category,
    description: description || '',
    file_url: fileUrl,
    type: file.mimetype.startsWith('video/') ? 'video' : 'audio',
    status: 'Pending',
    created_at: dayjs().toISOString(),
    duration_ms: null,
    source: 'upload'
  });
  res.render('upload_result', { ok: true });
});

app.get('/api/recordings', async (req, res) => {
  const items = await db.searchLibrary({
    q: req.query.q,
    category: req.query.category,
    type: req.query.type,
    sort: req.query.sort,
    status: req.query.status || 'Approved'
  });
  res.json(items);
});

app.post('/api/requests', upload.single('file'), async (req, res) => {
  const { name, email, requestType, message } = req.body;
  if (!name || !requestType) return res.status(400).send('Missing fields');
  const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
  await db.insertRequest({
    id: uuidv4(),
    name,
    email: email || null,
    request_type: requestType,
    message: message || '',
    file_url: fileUrl,
    created_at: dayjs().toISOString(),
    status: 'New'
  });
  res.render('request_result', { ok: true });
});

app.get('/admin/login', (req, res) => {
  res.render('admin_login');
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const okUser = username === ADMIN_USERNAME;
  const okPass = bcrypt.compareSync(password || '', ADMIN_PASSWORD_HASH);
  if (!okUser || !okPass) return res.render('admin_login', { error: 'Invalid credentials' });
  const token = jwt.sign({ u: username }, JWT_SECRET, { expiresIn: '1d' });
  res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax' });
  res.redirect('/admin');
});

app.get('/admin', requireAdmin, async (req, res) => {
  const stats = await db.adminStats();
  res.render('admin_dashboard', { stats });
});

app.get('/admin/recordings', requireAdmin, async (req, res) => {
  const list = await db.listRecordings({ status: 'Any' });
  res.render('admin_recordings', { list });
});

app.post('/admin/recordings/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  await db.updateRecordingStatus(req.params.id, status);
  res.redirect('/admin/recordings');
});

app.post('/admin/recordings/:id/edit', requireAdmin, async (req, res) => {
  const { title, category, description } = req.body;
  await db.editRecording(req.params.id, { title, category, description });
  res.redirect('/admin/recordings');
});

app.post('/admin/recordings/:id/delete', requireAdmin, async (req, res) => {
  const rec = await db.getRecording(req.params.id);
  if (rec && rec.file_url && rec.source !== 'youtube') {
    const p = path.join(publicDir, rec.file_url.replace('/uploads/', 'uploads/'));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  await db.deleteRecording(req.params.id);
  res.redirect('/admin/recordings');
});

app.get('/admin/youtube', requireAdmin, async (req, res) => {
  const items = await db.listYouTube();
  res.render('admin_youtube', { items });
});

app.post('/admin/youtube', requireAdmin, async (req, res) => {
  const { url, title, category, description } = req.body;
  const videoId = db.extractYouTubeId(url);
  if (!videoId) return res.render('admin_youtube', { error: 'Invalid URL', items: db.listYouTube() });
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const vTitle = title && title.trim() ? title.trim() : `YouTube Video ${videoId}`;
  await db.insertRecording({
    id: uuidv4(),
    title: vTitle,
    name: 'YouTube',
    email: null,
    category: category || 'Podcast Episode',
    description: description || '',
    file_url: `https://www.youtube.com/watch?v=${videoId}`,
    type: 'youtube',
    status: 'Pending',
    created_at: dayjs().toISOString(),
    duration_ms: null,
    source: 'youtube',
    thumbnail_url: thumb
  });
  res.redirect('/admin/youtube');
});

app.get('/admin/requests', requireAdmin, async (req, res) => {
  const list = await db.listRequests();
  res.render('admin_requests', { list });
});

app.post('/admin/requests/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  await db.updateRequestStatus(req.params.id, status);
  res.redirect('/admin/requests');
});

app.get('/admin/featured', requireAdmin, async (req, res) => {
  const home = await db.listFeatured('home');
  const requests = await db.listFeatured('requests');
  const all = await db.listRecordings({ status: 'Approved' });
  res.render('admin_featured', { home, requests, all });
});

app.post('/admin/featured', requireAdmin, async (req, res) => {
  const { location, itemId } = req.body;
  await db.setFeatured(location, itemId);
  res.redirect('/admin/featured');
});

const EXTERNAL_BASE = 'https://imediapodcast.base44.app';
function proxyExternal(req, res, next) {
  const skipPrefixes = ['/css', '/js', '/uploads', '/admin', '/record', '/library', '/requests', '/api', '/mirror'];
  if (skipPrefixes.some(p => req.path.startsWith(p))) return next();
  const url = EXTERNAL_BASE + req.originalUrl;
  https.get(url, (r) => {
    const headers = { ...r.headers };
    if (headers['content-security-policy']) delete headers['content-security-policy'];
    res.writeHead(r.statusCode || 200, headers);
    r.pipe(res);
  }).on('error', (err) => { next(); });
}

app.get('/mirror', (req, res) => {
  const url = EXTERNAL_BASE + '/';
  https.get(url, (r) => {
    const headers = { ...r.headers };
    if (headers['content-security-policy']) delete headers['content-security-policy'];
    res.writeHead(r.statusCode || 200, headers);
    r.pipe(res);
  }).on('error', () => res.status(502).send('External site unreachable'));
});

app.get('/mirror/*', (req, res) => {
  const url = EXTERNAL_BASE + req.url;
  https.get(url, (r) => {
    const headers = { ...r.headers };
    if (headers['content-security-policy']) delete headers['content-security-policy'];
    res.writeHead(r.statusCode || 200, headers);
    r.pipe(res);
  }).on('error', () => res.status(502).send('External site unreachable'));
});

app.use(proxyExternal);

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {});
}
app.get('/admin/streams', requireAdmin, async (req, res) => {
  const list = await db.listStreams('Any');
  res.render('admin_streams', { list });
});
app.post('/admin/streams', requireAdmin, async (req, res) => {
  const { title, url, kind, status } = req.body;
  await db.insertStream({ id: uuidv4(), title, url, kind, status: status || 'Active', created_at: dayjs().toISOString() });
  res.redirect('/admin/streams');
});
app.post('/admin/streams/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  await db.updateStreamStatus(req.params.id, status);
  res.redirect('/admin/streams');
});
app.post('/admin/streams/:id/edit', requireAdmin, async (req, res) => {
  const { title, url, kind } = req.body;
  await db.editStream(req.params.id, { title, url, kind });
  res.redirect('/admin/streams');
});
app.post('/admin/streams/:id/delete', requireAdmin, async (req, res) => {
  await db.deleteStream(req.params.id);
  res.redirect('/admin/streams');
});
