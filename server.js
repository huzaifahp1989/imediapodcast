const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const expressLayouts = require('express-ejs-layouts');
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
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
const uploadsDir = path.join(publicDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadsDir); },
  filename: function (req, file, cb) {
    const id = uuidv4();
    const ext = path.extname(file.originalname || '');
    const nameSafe = (req.body.title || file.originalname || 'file').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    cb(null, `${id}-${nameSafe}${ext}`);
  }
});
const upload = multer({
  storage,
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

app.get('/', (req, res) => {
  const latest = db.listRecordings({ status: 'Approved', limit: 10 });
  res.render('home', { latest });
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

app.post('/api/recordings', upload.single('media'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });
  const { fullName, email, title, category, description, durationMs, source } = req.body;
  if (!fullName || !title || !category) return res.status(400).json({ error: 'Missing fields' });
  const id = uuidv4();
  const fileUrl = `/uploads/${file.filename}`;
  db.insertRecording({
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

app.post('/api/upload', upload.single('media'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send('No file');
  const { fullName, email, title, category, description } = req.body;
  if (!fullName || !title || !category) return res.status(400).send('Missing fields');
  const id = uuidv4();
  const fileUrl = `/uploads/${file.filename}`;
  db.insertRecording({
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

app.get('/api/recordings', (req, res) => {
  const items = db.searchLibrary({
    q: req.query.q,
    category: req.query.category,
    type: req.query.type,
    sort: req.query.sort,
    status: req.query.status || 'Approved'
  });
  res.json(items);
});

app.post('/api/requests', upload.single('file'), (req, res) => {
  const { name, email, requestType, message } = req.body;
  if (!name || !requestType) return res.status(400).send('Missing fields');
  const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
  db.insertRequest({
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

app.get('/admin', requireAdmin, (req, res) => {
  const stats = db.adminStats();
  res.render('admin_dashboard', { stats });
});

app.get('/admin/recordings', requireAdmin, (req, res) => {
  const list = db.listRecordings({ status: 'Any' });
  res.render('admin_recordings', { list });
});

app.post('/admin/recordings/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.updateRecordingStatus(req.params.id, status);
  res.redirect('/admin/recordings');
});

app.post('/admin/recordings/:id/edit', requireAdmin, (req, res) => {
  const { title, category, description } = req.body;
  db.editRecording(req.params.id, { title, category, description });
  res.redirect('/admin/recordings');
});

app.post('/admin/recordings/:id/delete', requireAdmin, (req, res) => {
  const rec = db.getRecording(req.params.id);
  if (rec && rec.file_url && rec.source !== 'youtube') {
    const p = path.join(publicDir, rec.file_url.replace('/uploads/', 'uploads/'));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.deleteRecording(req.params.id);
  res.redirect('/admin/recordings');
});

app.get('/admin/youtube', requireAdmin, (req, res) => {
  const items = db.listYouTube();
  res.render('admin_youtube', { items });
});

app.post('/admin/youtube', requireAdmin, async (req, res) => {
  const { url, title, category, description } = req.body;
  const videoId = db.extractYouTubeId(url);
  if (!videoId) return res.render('admin_youtube', { error: 'Invalid URL', items: db.listYouTube() });
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const vTitle = title && title.trim() ? title.trim() : `YouTube Video ${videoId}`;
  db.insertRecording({
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

app.get('/admin/requests', requireAdmin, (req, res) => {
  const list = db.listRequests();
  res.render('admin_requests', { list });
});

app.post('/admin/requests/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.updateRequestStatus(req.params.id, status);
  res.redirect('/admin/requests');
});

app.get('/admin/featured', requireAdmin, (req, res) => {
  const home = db.listFeatured('home');
  const requests = db.listFeatured('requests');
  const all = db.listRecordings({ status: 'Approved' });
  res.render('admin_featured', { home, requests, all });
});

app.post('/admin/featured', requireAdmin, (req, res) => {
  const { location, itemId } = req.body;
  db.setFeatured(location, itemId);
  res.redirect('/admin/featured');
});

app.listen(PORT, () => {});