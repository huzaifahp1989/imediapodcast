const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const baseDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..');
const dbDir = path.join(baseDir, 'data');
const dbPath = path.join(dbDir, 'app.db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  title TEXT,
  name TEXT,
  email TEXT,
  category TEXT,
  description TEXT,
  file_url TEXT,
  type TEXT,
  status TEXT,
  created_at TEXT,
  duration_ms INTEGER,
  source TEXT,
  thumbnail_url TEXT,
  plays INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  request_type TEXT,
  message TEXT,
  file_url TEXT,
  created_at TEXT,
  status TEXT
);
CREATE TABLE IF NOT EXISTS featured (
  id TEXT PRIMARY KEY,
  location TEXT,
  item_id TEXT
);
`);

function insertRecording(r) {
  db.prepare(`INSERT INTO recordings (id,title,name,email,category,description,file_url,type,status,created_at,duration_ms,source,thumbnail_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.id, r.title, r.name, r.email, r.category, r.description, r.file_url, r.type, r.status, r.created_at, r.duration_ms, r.source, r.thumbnail_url || null
  );
}
function listRecordings({ status = 'Approved', limit = 100 } = {}) {
  if (status === 'Any') return db.prepare(`SELECT * FROM recordings ORDER BY datetime(created_at) DESC LIMIT ?`).all(limit);
  return db.prepare(`SELECT * FROM recordings WHERE status=? ORDER BY datetime(created_at) DESC LIMIT ?`).all(status, limit);
}
function searchLibrary({ q, category, type, sort = 'latest', status = 'Approved' } = {}) {
  let sql = `SELECT * FROM recordings WHERE status=?`;
  const args = [status];
  if (q && q.trim()) {
    sql += ` AND (LOWER(title) LIKE ? OR LOWER(name) LIKE ?)`;
    args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  if (category && category !== 'All') {
    sql += ` AND category=?`;
    args.push(category);
  }
  if (type && type !== 'All') {
    sql += ` AND type=?`;
    args.push(type.toLowerCase());
  }
  if (sort === 'oldest') sql += ` ORDER BY datetime(created_at) ASC`;
  else if (sort === 'most') sql += ` ORDER BY plays DESC`;
  else sql += ` ORDER BY datetime(created_at) DESC`;
  return db.prepare(sql).all(...args);
}
function getRecording(id) {
  return db.prepare(`SELECT * FROM recordings WHERE id=?`).get(id);
}
function updateRecordingStatus(id, status) {
  db.prepare(`UPDATE recordings SET status=? WHERE id=?`).run(status, id);
}
function editRecording(id, { title, category, description }) {
  db.prepare(`UPDATE recordings SET title=?, category=?, description=? WHERE id=?`).run(title, category, description, id);
}
function deleteRecording(id) {
  db.prepare(`DELETE FROM recordings WHERE id=?`).run(id);
}
function insertRequest(r) {
  db.prepare(`INSERT INTO requests (id,name,email,request_type,message,file_url,created_at,status) VALUES (?,?,?,?,?,?,?,?)`).run(
    r.id, r.name, r.email, r.request_type, r.message, r.file_url, r.created_at, r.status
  );
}
function listRequests() {
  return db.prepare(`SELECT * FROM requests ORDER BY datetime(created_at) DESC`).all();
}
function updateRequestStatus(id, status) {
  db.prepare(`UPDATE requests SET status=? WHERE id=?`).run(status, id);
}
function listYouTube() {
  return db.prepare(`SELECT * FROM recordings WHERE source='youtube' ORDER BY datetime(created_at) DESC`).all();
}
function listFeatured(location) {
  return db.prepare(`SELECT f.id, f.location, f.item_id, r.title, r.category, r.name, r.file_url, r.type, r.thumbnail_url FROM featured f LEFT JOIN recordings r ON r.id=f.item_id WHERE f.location=?`).all(location);
}
function setFeatured(location, itemId) {
  const id = require('uuid').v4();
  db.prepare(`INSERT INTO featured (id,location,item_id) VALUES (?,?,?)`).run(id, location, itemId);
}
function adminStats() {
  const total = db.prepare(`SELECT COUNT(*) c FROM recordings`).get().c;
  const pending = db.prepare(`SELECT COUNT(*) c FROM recordings WHERE status='Pending'`).get().c;
  const approved = db.prepare(`SELECT COUNT(*) c FROM recordings WHERE status='Approved'`).get().c;
  const requests = db.prepare(`SELECT COUNT(*) c FROM requests`).get().c;
  return { total, pending, approved, requests };
}
function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

module.exports = {
  insertRecording,
  listRecordings,
  searchLibrary,
  getRecording,
  updateRecordingStatus,
  editRecording,
  deleteRecording,
  insertRequest,
  listRequests,
  updateRequestStatus,
  listYouTube,
  listFeatured,
  setFeatured,
  adminStats,
  extractYouTubeId
};