/**
 * TUJP tree register: backend for the tree pages on trees.theurbanjungleproject.com.
 *
 * Lives in the Google Sheet (Extensions > Apps Script). Source of truth is the
 * GitHub repo: edit here in apps-script/, then `clasp push`.
 * Deploy as a web app: Execute as "Me", Who has access "Anyone".
 * Reads are public but only return PUBLIC_FIELDS. Every write checks a
 * Google sign-in token and only accepts accounts from ALLOWED_DOMAIN.
 */

// ---------- Settings (fill in CLIENT_ID, check the rest) ----------
const CLIENT_ID = '446368725574-om35kgq8n2vopqkdqothjck75t8pkvsh.apps.googleusercontent.com';
const ALLOWED_DOMAIN = 'theurbanjungleproject.com';
const PHOTO_FOLDER_ID = '11YCIGYVPdOdPDSMtSfe5qxwWMi2V7Zkn'; // Visits_Images folder in Drive
const PHOTO_PATH_PREFIX = 'Visits_Images/';                   // keeps AppSheet able to show the photos
const PUBLIC_FIELDS = ['tag_label', 'species', 'project', 'product_type', 'install_date'];
const REPORT_EMAIL = '';   // leave empty to email the script owner, or 'none' for no email
const MAX_VISITS_SHOWN = 10;

const TREES = 'Trees', VISITS = 'Visits', LISTS = 'Lists', REPORTS = 'Reports';
const LOCKED = ['tree_id', 'tag_label', 'id_check', 'qr_url'];
// Statuses that mean "no tree linked yet". Reserved = ID claimed for a tag being programmed,
// Tagged = ID already on a pre-programmed tag from the supplier (never handed out by claim).
const OPEN_STATUSES = ['', 'Unassigned', 'Reserved', 'Tagged'];

// ---------- Entry points ----------
function doGet() {
  return json_({ ok: true, service: 'tujp-tree-register' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const user = req.token ? verifyToken_(req.token) : null;
    if (req.action === 'whoami') return json_({ ok: true, staff: !!user, user: user ? user.email : null });
    if (req.action === 'claim') return json_(withStaff_(user, () => claimNext_(user)));

    const id = normaliseId_(req.id);
    if (!id) return json_({ ok: false, error: 'invalid_id' });
    switch (req.action) {
      case 'get': return json_(getTree_(id, user));
      case 'register': return json_(withStaff_(user, () => saveTree_(id, req.fields || {}, user, true)));
      case 'update': return json_(withStaff_(user, () => saveTree_(id, req.fields || {}, user, false)));
      case 'visit': return json_(withStaff_(user, () => addVisit_(id, req, user)));
      case 'report': return json_(addReport_(id, req));
      default: return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error', detail: String(err && err.message || err) });
  }
}

// ---------- Read ----------
function getTree_(id, user) {
  const t = trees_();
  const row = findRow_(t, id);
  if (!row) return { ok: false, error: 'not_found' };
  const values = t.sheet.getRange(row, 1, 1, t.headers.length).getDisplayValues()[0];
  const rec = {};
  t.keys.forEach((k, i) => { rec[k] = values[i]; });
  const registered = OPEN_STATUSES.indexOf(rec.status) === -1;

  if (!user) {
    const pub = {};
    if (registered) PUBLIC_FIELDS.forEach(k => { if (k in rec && rec[k] !== '') pub[k] = rec[k]; });
    return { ok: true, staff: false, id: id, label: rec.tag_label || labelOf_(id), registered: registered, tree: pub };
  }
  return {
    ok: true, staff: true, user: user.email, id: id, label: rec.tag_label || labelOf_(id),
    registered: registered, tree: rec, schema: schema_(t), visits: visits_(id)
  };
}

function schema_(t) {
  const lists = lists_();
  return t.keys.map((k, i) => {
    let type = 'text';
    if (k.indexOf('date') !== -1) type = 'date';
    else if (k === 'latitude' || k === 'longitude') type = 'number';
    else if (k === 'gps') type = 'gps';
    else if (k === 'notes') type = 'textarea';
    if (lists[k]) type = 'list';
    return { key: k, header: t.headers[i], type: type, options: lists[k] || null, locked: LOCKED.indexOf(k) !== -1 };
  }).filter(f => f.key !== '');
}

function visits_(id) {
  const sh = ss_().getSheetByName(VISITS);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getDisplayValues();
  const keys = data[0].map(norm_);
  const ti = keys.indexOf('tree_id');
  const folder = photoFolder_();
  const out = [];
  for (let r = data.length - 1; r >= 1 && out.length < MAX_VISITS_SHOWN; r--) {
    if (normaliseId_(data[r][ti]) !== id) continue;
    const v = {};
    keys.forEach((k, i) => { v[k] = data[r][i]; });
    v.photos = ['photo_close', 'photo_medium', 'photo_wide']
      .filter(k => v[k])
      .map(k => photoLink_(folder, v[k], k.replace('photo_', '')));
    out.push(v);
  }
  return out;
}

function photoLink_(folder, path, shot) {
  const name = String(path).split('/').pop();
  const files = folder ? folder.getFilesByName(name) : null;
  if (!files || !files.hasNext()) return { shot: shot, name: name };
  const fid = files.next().getId();
  return {
    shot: shot, name: name,
    thumb: 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w600',
    url: 'https://drive.google.com/file/d/' + fid + '/view'
  };
}

// ---------- Write ----------
function saveTree_(id, fields, user, isRegister) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = trees_();
    const row = findRow_(t, id);
    if (!row) return { ok: false, error: 'not_found' };
    const statusCol = t.keys.indexOf('status');
    const current = statusCol === -1 ? '' : String(t.sheet.getRange(row, statusCol + 1).getDisplayValue());
    const registered = OPEN_STATUSES.indexOf(current) === -1;
    if (isRegister && registered) return { ok: false, error: 'already_registered' };
    if (!isRegister && !registered) return { ok: false, error: 'not_registered' };

    const range = t.sheet.getRange(row, 1, 1, t.headers.length);
    const rowVals = range.getValues()[0];
    const formulas = range.getFormulas()[0];
    t.keys.forEach((k, i) => {
      if (!k || LOCKED.indexOf(k) !== -1 || formulas[i]) return;
      if (!(k in fields)) return;
      rowVals[i] = toCell_(k, fields[k]);
    });
    if (isRegister && statusCol !== -1) rowVals[statusCol] = 'Active';
    // Write only the editable cells so locked columns and formulas stay untouched.
    t.keys.forEach((k, i) => {
      if (!k || LOCKED.indexOf(k) !== -1 || formulas[i]) return;
      if (!(k in fields) && !(isRegister && i === statusCol)) return;
      t.sheet.getRange(row, i + 1).setValue(rowVals[i]);
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Reserve the first Unassigned ID so a blank tag can be programmed with it.
function claimNext_(user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = trees_();
    const idCol = t.keys.indexOf('tree_id'), stCol = t.keys.indexOf('status');
    if (idCol === -1 || stCol === -1 || t.sheet.getLastRow() < 2) return { ok: false, error: 'sheet_layout' };
    const n = t.sheet.getLastRow() - 1;
    const ids = t.sheet.getRange(2, idCol + 1, n, 1).getDisplayValues();
    const sts = t.sheet.getRange(2, stCol + 1, n, 1).getDisplayValues();
    for (let i = 0; i < n; i++) {
      if (sts[i][0] === 'Unassigned' && normaliseId_(ids[i][0])) {
        t.sheet.getRange(i + 2, stCol + 1).setValue('Reserved');
        const noteCol = t.keys.indexOf('notes');
        if (noteCol !== -1 && !formulaAt_(t, i + 2, noteCol + 1)) {
          const stamp = Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
          t.sheet.getRange(i + 2, noteCol + 1).setValue('Tag programmed ' + stamp + ' by ' + user.email);
        }
        return { ok: true, id: ids[i][0], label: labelOf_(ids[i][0]) };
      }
    }
    return { ok: false, error: 'no_free_ids' };
  } finally {
    lock.releaseLock();
  }
}

function formulaAt_(t, row, col) {
  return t.sheet.getRange(row, col).getFormulas()[0][0] !== '';
}

function addVisit_(id, req, user) {
  const t = trees_();
  if (!findRow_(t, id)) return { ok: false, error: 'not_found' };
  const tz = ss_().getSpreadsheetTimeZone();
  const now = new Date();
  const stamp = Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss');
  const folder = photoFolder_();
  const photos = req.photos || {};
  const cells = {
    visit_id: Utilities.getUuid().slice(0, 8),
    tree_id: id,
    visited_at: now,
    gps: req.gps ? String(req.gps) : '',
    visited_by: user.email,
    notes: String(req.notes || '').slice(0, 2000)
  };
  ['close', 'medium', 'wide'].forEach(shot => {
    const b64 = photos[shot];
    if (!b64) return;
    const name = id + '_' + stamp + '_' + shot + '.jpg';
    const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name);
    folder.createFile(blob);
    cells['photo_' + shot] = PHOTO_PATH_PREFIX + name;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName(VISITS);
    const keys = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
    sh.appendRow(keys.map(k => (k in cells ? cells[k] : '')));
  } finally {
    lock.releaseLock();
  }
  return { ok: true, visit_id: cells.visit_id };
}

function addReport_(id, req) {
  if (req.website) return { ok: true }; // honeypot: bots fill hidden fields
  const msg = String(req.message || '').trim().slice(0, 1000);
  if (msg.length < 3) return { ok: false, error: 'empty_message' };
  const cache = CacheService.getScriptCache();
  const perTree = Number(cache.get('rep_' + id) || 0);
  const total = Number(cache.get('rep_all') || 0);
  if (perTree >= 5 || total >= 100) return { ok: false, error: 'too_many_reports' };
  cache.put('rep_' + id, String(perTree + 1), 3600);
  cache.put('rep_all', String(total + 1), 3600);

  const ss = ss_();
  let sh = ss.getSheetByName(REPORTS);
  if (!sh) {
    sh = ss.insertSheet(REPORTS);
    sh.appendRow(['received_at', 'tree_id', 'message', 'contact', 'handled']);
  }
  const contact = String(req.contact || '').slice(0, 200);
  sh.appendRow([new Date(), id, msg, contact, '']);

  if (REPORT_EMAIL !== 'none') {
    const to = REPORT_EMAIL || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail(to, 'Tree report for ' + labelOf_(id),
      'Tree ' + labelOf_(id) + '\n\n' + msg + '\n\nContact: ' + (contact || '-') +
      '\n\nSee the Reports tab in the tree register.');
  }
  return { ok: true };
}

// ---------- Auth ----------
function verifyToken_(token) {
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' +
    encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const info = JSON.parse(res.getContentText());
  const ok = info.aud === CLIENT_ID &&
    String(info.email_verified) === 'true' &&
    info.hd === ALLOWED_DOMAIN &&
    Number(info.exp) * 1000 > Date.now();
  if (!ok) return null;
  const user = { email: info.email };
  const ttl = Math.max(1, Math.min(600, Number(info.exp) - Math.floor(Date.now() / 1000)));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function withStaff_(user, fn) {
  if (!user) return { ok: false, error: 'not_signed_in' };
  return fn();
}

// ---------- Helpers ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function trees_() {
  const sheet = ss_().getSheetByName(TREES);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  return { sheet: sheet, headers: headers, keys: headers.map(norm_) };
}

function findRow_(t, id) {
  const col = t.keys.indexOf('tree_id') + 1;
  if (col === 0 || t.sheet.getLastRow() < 2) return 0;
  const cell = t.sheet.getRange(2, col, t.sheet.getLastRow() - 1, 1)
    .createTextFinder(id).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function lists_() {
  const sh = ss_().getSheetByName(LISTS);
  if (!sh) return {};
  const data = sh.getDataRange().getDisplayValues();
  const out = {};
  data[0].forEach((h, c) => {
    const k = norm_(h);
    if (!k) return;
    const vals = data.slice(1).map(r => r[c]).filter(v => v !== '');
    if (vals.length) out[k] = vals;
  });
  return out;
}

function photoFolder_() {
  try { return DriveApp.getFolderById(PHOTO_FOLDER_ID); } catch (e) { return null; }
}

function toCell_(key, value) {
  if (value === null || value === undefined) return '';
  const v = String(value).trim();
  if (key.indexOf('date') !== -1 && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const p = v.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  if ((key === 'latitude' || key === 'longitude') && v !== '' && !isNaN(Number(v))) return Number(v);
  return v.slice(0, 2000);
}

function norm_(h) {
  return String(h).trim().toLowerCase().replace(/[\s\-]+/g, '_');
}

function normaliseId_(raw) {
  const s = String(raw || '').replace(/[^0-9]/g, '');
  if (s.length !== 5) return '';
  return luhn_(s.slice(0, 4)) === Number(s[4]) ? s : '';
}

function luhn_(payload) {
  let total = 0;
  payload.split('').reverse().forEach((ch, i) => {
    let d = Number(ch);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    total += d;
  });
  return (10 - total % 10) % 10;
}

function labelOf_(id) { return id.slice(0, 4) + '-' + id.slice(4); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor to grant permissions and check the set-up.
function testSetup() {
  const t = trees_();
  console.log('Trees columns: ' + t.keys.join(', '));
  console.log('Photo folder: ' + (photoFolder_() ? photoFolder_().getName() : 'NOT FOUND'));
  console.log(JSON.stringify(getTree_('00018', null)));
}
