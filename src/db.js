const path = require('path');
const fs = require('fs');
const usePg = !!process.env.DATABASE_URL;
let Database, db, Pool, pool;

  if (usePg) {
    ({ Pool } = require('pg'));
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    (async () => {
    await pool.query(`
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
      duration_ms BIGINT,
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
    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      title TEXT,
      url TEXT,
      kind TEXT,
      status TEXT,
      created_at TEXT
    );
    `);
  })();
} else {
  Database = require('better-sqlite3');
  const baseDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..');
  const dbDir = path.join(baseDir, 'data');
  const dbPath = path.join(dbDir, 'app.db');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  db = new Database(dbPath);
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
  CREATE TABLE IF NOT EXISTS streams (
    id TEXT PRIMARY KEY,
    title TEXT,
    url TEXT,
    kind TEXT,
    status TEXT,
    created_at TEXT
  );
  `);
}

async function insertRecording(r) {
  if (usePg) {
    await pool.query(`INSERT INTO recordings (id,title,name,email,category,description,file_url,type,status,created_at,duration_ms,source,thumbnail_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.id, r.title, r.name, r.email, r.category, r.description, r.file_url, r.type, r.status, r.created_at, r.duration_ms, r.source, r.thumbnail_url || null]);
  } else {
    db.prepare(`INSERT INTO recordings (id,title,name,email,category,description,file_url,type,status,created_at,duration_ms,source,thumbnail_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      r.id, r.title, r.name, r.email, r.category, r.description, r.file_url, r.type, r.status, r.created_at, r.duration_ms, r.source, r.thumbnail_url || null
    );
  }
}
async function listRecordings({ status = 'Approved', limit = 100 } = {}) {
  if (usePg) {
    if (status === 'Any') return (await pool.query(`SELECT * FROM recordings ORDER BY to_timestamp(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') DESC LIMIT $1`, [limit])).rows;
    return (await pool.query(`SELECT * FROM recordings WHERE status=$1 ORDER BY to_timestamp(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') DESC LIMIT $2`, [status, limit])).rows;
  } else {
    if (status === 'Any') return db.prepare(`SELECT * FROM recordings ORDER BY datetime(created_at) DESC LIMIT ?`).all(limit);
    return db.prepare(`SELECT * FROM recordings WHERE status=? ORDER BY datetime(created_at) DESC LIMIT ?`).all(status, limit);
  }
}
async function searchLibrary({ q, category, type, sort = 'latest', status = 'Approved' } = {}) {
  if (usePg) {
    let sql = `SELECT * FROM recordings WHERE status=$1`;
    const args = [status];
    let idx = 2;
    if (q && q.trim()) { sql += ` AND (LOWER(title) LIKE $${idx} OR LOWER(name) LIKE $${idx+1})`; args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`); idx+=2; }
    if (category && category !== 'All') { sql += ` AND category=$${idx}`; args.push(category); idx++; }
    if (type && type !== 'All') { sql += ` AND type=$${idx}`; args.push(type.toLowerCase()); idx++; }
    if (sort === 'oldest') sql += ` ORDER BY created_at ASC`;
    else if (sort === 'most') sql += ` ORDER BY plays DESC`;
    else sql += ` ORDER BY created_at DESC`;
    return (await pool.query(sql, args)).rows;
  } else {
    let sql = `SELECT * FROM recordings WHERE status=?`;
    const args = [status];
    if (q && q.trim()) { sql += ` AND (LOWER(title) LIKE ? OR LOWER(name) LIKE ?)`; args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`); }
    if (category && category !== 'All') { sql += ` AND category=?`; args.push(category); }
    if (type && type !== 'All') { sql += ` AND type=?`; args.push(type.toLowerCase()); }
    if (sort === 'oldest') sql += ` ORDER BY datetime(created_at) ASC`; else if (sort === 'most') sql += ` ORDER BY plays DESC`; else sql += ` ORDER BY datetime(created_at) DESC`;
    return db.prepare(sql).all(...args);
  }
}
async function getRecording(id) {
  if (usePg) return (await pool.query(`SELECT * FROM recordings WHERE id=$1`, [id])).rows[0];
  return db.prepare(`SELECT * FROM recordings WHERE id=?`).get(id);
}
async function updateRecordingStatus(id, status) {
  if (usePg) await pool.query(`UPDATE recordings SET status=$1 WHERE id=$2`, [status, id]);
  else db.prepare(`UPDATE recordings SET status=? WHERE id=?`).run(status, id);
}
async function editRecording(id, { title, category, description }) {
  if (usePg) await pool.query(`UPDATE recordings SET title=$1, category=$2, description=$3 WHERE id=$4`, [title, category, description, id]);
  else db.prepare(`UPDATE recordings SET title=?, category=?, description=? WHERE id=?`).run(title, category, description, id);
}
async function deleteRecording(id) {
  if (usePg) await pool.query(`DELETE FROM recordings WHERE id=$1`, [id]);
  else db.prepare(`DELETE FROM recordings WHERE id=?`).run(id);
}
async function insertRequest(r) {
  if (usePg) await pool.query(`INSERT INTO requests (id,name,email,request_type,message,file_url,created_at,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [r.id, r.name, r.email, r.request_type, r.message, r.file_url, r.created_at, r.status]);
  else db.prepare(`INSERT INTO requests (id,name,email,request_type,message,file_url,created_at,status) VALUES (?,?,?,?,?,?,?,?)`).run(r.id, r.name, r.email, r.request_type, r.message, r.file_url, r.created_at, r.status);
}
async function listRequests() {
  if (usePg) return (await pool.query(`SELECT * FROM requests ORDER BY created_at DESC`)).rows;
  return db.prepare(`SELECT * FROM requests ORDER BY datetime(created_at) DESC`).all();
}
async function updateRequestStatus(id, status) {
  if (usePg) await pool.query(`UPDATE requests SET status=$1 WHERE id=$2`, [status, id]);
  else db.prepare(`UPDATE requests SET status=? WHERE id=?`).run(status, id);
}
async function listYouTube() {
  if (usePg) return (await pool.query(`SELECT * FROM recordings WHERE source='youtube' ORDER BY created_at DESC`)).rows;
  return db.prepare(`SELECT * FROM recordings WHERE source='youtube' ORDER BY datetime(created_at) DESC`).all();
}
async function listFeatured(location) {
  if (usePg) return (await pool.query(`SELECT f.id, f.location, f.item_id, r.title, r.category, r.name, r.file_url, r.type, r.thumbnail_url FROM featured f LEFT JOIN recordings r ON r.id=f.item_id WHERE f.location=$1`, [location])).rows;
  return db.prepare(`SELECT f.id, f.location, f.item_id, r.title, r.category, r.name, r.file_url, r.type, r.thumbnail_url FROM featured f LEFT JOIN recordings r ON r.id=f.item_id WHERE f.location=?`).all(location);
}
async function setFeatured(location, itemId) {
  const id = require('uuid').v4();
  if (usePg) await pool.query(`INSERT INTO featured (id,location,item_id) VALUES ($1,$2,$3)`, [id, location, itemId]);
  else db.prepare(`INSERT INTO featured (id,location,item_id) VALUES (?,?,?)`).run(id, location, itemId);
}
async function adminStats() {
  if (usePg) {
    const total = (await pool.query(`SELECT COUNT(*) c FROM recordings`)).rows[0].c;
    const pending = (await pool.query(`SELECT COUNT(*) c FROM recordings WHERE status='Pending'`)).rows[0].c;
    const approved = (await pool.query(`SELECT COUNT(*) c FROM recordings WHERE status='Approved'`)).rows[0].c;
    const requests = (await pool.query(`SELECT COUNT(*) c FROM requests`)).rows[0].c;
    const streams = (await pool.query(`SELECT COUNT(*) c FROM streams WHERE status='Active'`)).rows[0].c;
    return { total: Number(total), pending: Number(pending), approved: Number(approved), requests: Number(requests), streams: Number(streams) };
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM recordings`).get().c;
  const pending = db.prepare(`SELECT COUNT(*) c FROM recordings WHERE status='Pending'`).get().c;
  const approved = db.prepare(`SELECT COUNT(*) c FROM recordings WHERE status='Approved'`).get().c;
  const requests = db.prepare(`SELECT COUNT(*) c FROM requests`).get().c;
  const streams = db.prepare(`SELECT COUNT(*) c FROM streams WHERE status='Active'`).get().c;
  return { total, pending, approved, requests, streams };
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
  extractYouTubeId,
  insertStream: async (s) => {
    const id = s.id;
    const title = s.title;
    const url = s.url;
    const kind = s.kind;
    const status = s.status;
    const created_at = s.created_at;
    if (usePg) await pool.query(`INSERT INTO streams (id,title,url,kind,status,created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [id, title, url, kind, status, created_at]);
    else db.prepare(`INSERT INTO streams (id,title,url,kind,status,created_at) VALUES (?,?,?,?,?,?)`).run(id, title, url, kind, status, created_at);
  },
  listStreams: async (status='Active') => {
    if (usePg) return (await pool.query(status==='Any'?`SELECT * FROM streams ORDER BY created_at DESC`:`SELECT * FROM streams WHERE status=$1 ORDER BY created_at DESC`, status==='Any'?[]:[status])).rows;
    return status==='Any'?db.prepare(`SELECT * FROM streams ORDER BY datetime(created_at) DESC`).all():db.prepare(`SELECT * FROM streams WHERE status=? ORDER BY datetime(created_at) DESC`).all(status);
  },
  updateStreamStatus: async (id, status) => {
    if (usePg) await pool.query(`UPDATE streams SET status=$1 WHERE id=$2`, [status, id]);
    else db.prepare(`UPDATE streams SET status=? WHERE id=?`).run(status, id);
  },
  editStream: async (id, { title, url, kind }) => {
    if (usePg) await pool.query(`UPDATE streams SET title=$1, url=$2, kind=$3 WHERE id=$4`, [title, url, kind, id]);
    else db.prepare(`UPDATE streams SET title=?, url=?, kind=? WHERE id=?`).run(title, url, kind, id);
  },
  deleteStream: async (id) => {
    if (usePg) await pool.query(`DELETE FROM streams WHERE id=$1`, [id]);
    else db.prepare(`DELETE FROM streams WHERE id=?`).run(id);
  }
};