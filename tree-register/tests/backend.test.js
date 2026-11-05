// Runs apps-script/Code.gs against in-memory mocks of the Apps Script services.
// Usage: node tests/backend.test.js apps-script/Code.gs
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const code = fs.readFileSync(process.argv[2], 'utf8');

function luhn(p) { let t = 0; p.split('').reverse().forEach((c, i) => { let d = +c; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } t += d; }); return (10 - t % 10) % 10; }
const ids = Array.from({ length: 5 }, (_, i) => { const p = String(i + 1).padStart(4, '0'); return p + luhn(p); });

function makeSheet(rows, formulas) {
  const s = {
    rows, formulas: formulas || {},
    getLastRow: () => s.rows.length, getLastColumn: () => Math.max(...s.rows.map(r => r.length)),
    getDataRange: () => s.getRange(1, 1, s.rows.length, s.getLastColumn()),
    appendRow: r => s.rows.push(r.slice()),
    getRange(r, c, nr = 1, nc = 1) {
      const cells = () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (s.rows[r - 1 + i] || [])[c - 1 + j] ?? ''));
      return {
        getValues: cells,
        getDisplayValues: () => cells().map(row => row.map(v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v))),
        getDisplayValue: () => String(cells()[0][0]),
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => s.formulas[(c + j)] || '')),
        setValue(v) { if (s.formulas[c]) throw new Error('wrote over formula column ' + c); s.rows[r - 1][c - 1] = v; },
        createTextFinder(text) { return { matchEntireCell() { return { findNext() {
          for (let i = 0; i < nr; i++) if (String((s.rows[r - 1 + i] || [])[c - 1]) === text) return { getRow: () => r + i };
          return null; } }; } }; }
      };
    }
  };
  return s;
}

const treesHeader = ['tree_id', 'tag_label', 'id_check', 'status', 'project', 'location', 'latitude', 'longitude', 'block_id', 'product_type', 'species', 'age', 'install date', 'sun exposure', 'notes'];
const trees = makeSheet([treesHeader, ...ids.map(id => [id, id.slice(0, 4) + '-' + id[4], 'OK', 'Unassigned', '', '', '', '', '', '', '', '', '', '', ''])], { 2: '=formula', 3: '=formula' });
const visits = makeSheet([['visit_id', 'tree_id', 'visited_at', 'photo_close', 'photo_medium', 'photo_wide', 'gps', 'visited_by', 'notes']]);
const lists = makeSheet([['status', 'product_type', 'sun_exposure', 'project'], ['Unassigned', 'Jungle Block', 'Full sun', 'NOS'], ['Active', 'Other', 'Shade', ''], ['Dead', '', '', ''], ['Replaced', '', '', '']]);
const sheets = { Trees: trees, Visits: visits, Lists: lists };
const files = [];
const cache = {};
const mails = [];
let tokenInfo = { aud: 'CID', email_verified: 'true', hd: 'theurbanjungleproject.com', email: 'ferdinand@theurbanjungleproject.com', exp: String(Math.floor(Date.now() / 1000) + 3600) };

const ctx = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet([])),
    getSpreadsheetTimeZone: () => 'Europe/Amsterdam' }) },
  Utilities: {
    formatDate: () => '20261104-101500', getUuid: () => crypto.randomUUID(),
    newBlob: (bytes, type, name) => ({ bytes, type, name }), base64Decode: b => Buffer.from(b, 'base64'),
    computeDigest: (a, s) => crypto.createHash('sha256').update(s).digest(), base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
    DigestAlgorithm: { SHA_256: 'sha256' } },
  DriveApp: { getFolderById: () => ({ getName: () => 'Visits_Images', createFile: b => { files.push(b.name); return { getId: () => 'F' + files.length }; },
    getFilesByName: n => { const i = files.indexOf(n); let done = i === -1; return { hasNext: () => !done, next: () => { done = true; return { getId: () => 'F' + (i + 1) }; } }; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(tokenInfo) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }) },
  MailApp: { sendEmail: (...a) => mails.push(a) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@theurbanjungleproject.com' }) }
};
vm.createContext(ctx);
vm.runInContext(code.replace("'PASTE-YOUR-OAUTH-CLIENT-ID.apps.googleusercontent.com'", "'CID'"), ctx);
const call = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });

let fails = 0;
const expect = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + JSON.stringify(extra))); if (!cond) fails++; };

let r = call({ action: 'get', id: '00019' });
expect('rejects bad check digit', r.error === 'invalid_id', r);
r = call({ action: 'get', id: '0001-8' });
expect('public get on unassigned', r.ok && !r.staff && !r.registered && Object.keys(r.tree).length === 0, r);
r = call({ action: 'register', id: '00018', fields: { species: 'Acer' } });
expect('register needs sign-in', r.error === 'not_signed_in', r);
r = call({ action: 'get', id: '00018', token: 'T1' });
expect('staff get returns schema with lists', r.staff && r.schema.find(f => f.key === 'sun_exposure').type === 'list' && r.schema.find(f => f.key === 'install_date').type === 'date', r.schema);
r = call({ action: 'register', id: '00018', token: 'T1', fields: { species: 'Acer campestre', project: 'NOS', install_date: '2026-11-02', latitude: '52.1', tree_id: '99999', tag_label: 'X', id_check: 'X', status: 'Dead' } });
expect('register ok', r.ok, r);
const row = trees.rows[1];
expect('locked columns untouched', row[0] === '00018' && row[1] === '0001-8' && row[2] === 'OK', row);
expect('status forced to Active', row[3] === 'Active', row);
expect('date stored as Date', Object.prototype.toString.call(row[12]) === '[object Date]', row[12]);
expect('latitude stored as number', row[6] === 52.1, row[6]);
r = call({ action: 'register', id: '00018', token: 'T1', fields: {} });
expect('second register refused', r.error === 'already_registered', r);
r = call({ action: 'update', id: '00026', token: 'T1', fields: { species: 'x' } });
expect('update on unassigned refused', r.error === 'not_registered', r);
r = call({ action: 'update', id: '00018', token: 'T1', fields: { location: 'North corner', status: 'Dead' } });
expect('update ok', r.ok && trees.rows[1][5] === 'North corner' && trees.rows[1][3] === 'Dead', trees.rows[1]);
trees.rows[1][3] = 'Active';
r = call({ action: 'get', id: '00018' });
expect('public get shows only public fields', r.registered && r.tree.species === 'Acer campestre' && !('location' in r.tree) && !('latitude' in r.tree), r.tree);
const jpg = Buffer.from('fakejpeg').toString('base64');
r = call({ action: 'visit', id: '00018', token: 'T1', photos: { close: jpg, wide: jpg }, notes: 'Looks fine', gps: '52.1, 4.3' });
expect('visit ok', r.ok, r);
const v = visits.rows[1];
expect('visit row mapped by header', v[1] === '00018' && v[3] === 'Visits_Images/00018_20261104-101500_close.jpg' && v[4] === '' && v[7] === 'ferdinand@theurbanjungleproject.com' && v[8] === 'Looks fine', v);
r = call({ action: 'get', id: '00018', token: 'T1' });
expect('visit listed with thumbnails', r.visits.length === 1 && r.visits[0].photos.length === 2 && r.visits[0].photos[0].thumb.includes('thumbnail?id=F1'), r.visits);
r = call({ action: 'report', id: '00018', message: 'Branch broken', contact: '' });
expect('report ok + email', r.ok && sheets.Reports.rows.length === 2 && mails.length === 1, r);
r = call({ action: 'report', id: '00018', message: 'spam', website: 'http://x' });
expect('honeypot silently ignored', r.ok && sheets.Reports.rows.length === 2, r);
for (let i = 0; i < 6; i++) r = call({ action: 'report', id: '00018', message: 'again ' + i });
expect('report rate limit', r.error === 'too_many_reports', r);
tokenInfo = Object.assign({}, tokenInfo, { hd: 'gmail.com' });
r = call({ action: 'get', id: '00018', token: 'T2' });
expect('other domain is public only', r.ok && !r.staff, r);
r = call({ action: 'visit', id: '00018', token: 'T2', notes: 'x' });
expect('other domain cannot write', r.error === 'not_signed_in', r);
tokenInfo = Object.assign({}, tokenInfo, { hd: 'theurbanjungleproject.com', aud: 'OTHER' });
r = call({ action: 'get', id: '00018', token: 'T3' });
expect('wrong client id is public only', !r.staff, r);
// Blank-tag flow
r = call({ action: 'claim' });
expect('claim needs sign-in', r.error === 'not_signed_in', r);
tokenInfo = Object.assign({}, tokenInfo, { aud: 'CID', hd: 'theurbanjungleproject.com' });
r = call({ action: 'claim', token: 'T4' });
expect('claim returns first Unassigned ID', r.ok && r.id === '00026' && trees.rows[2][3] === 'Reserved', r);
expect('claim notes who programmed the tag', String(trees.rows[2][14]).includes('ferdinand@'), trees.rows[2][14]);
r = call({ action: 'claim', token: 'T4' });
expect('second claim gets the next ID', r.ok && r.id === '00034', r);
r = call({ action: 'get', id: '00026' });
expect('reserved shows as not linked to public', r.ok && !r.registered, r);
r = call({ action: 'register', id: '00026', token: 'T4', fields: { species: 'Tilia' } });
expect('reserved ID can be registered', r.ok && trees.rows[2][3] === 'Active', trees.rows[2]);
r = call({ action: 'whoami', token: 'T4' });
expect('whoami for staff', r.ok && r.staff && r.user.startsWith('ferdinand'), r);
r = call({ action: 'whoami' });
expect('whoami for public', r.ok && !r.staff, r);
trees.rows.slice(1).forEach(row => { if (row[3] === 'Unassigned') row[3] = 'Active'; });
r = call({ action: 'claim', token: 'T4' });
expect('no free IDs reported', r.error === 'no_free_ids', r);
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
