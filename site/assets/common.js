// Shared helpers for the tree pages: IDs, sign-in, API calls, small UI bits.
const CONFIG = window.TREE_CONFIG;
const state = { id: null, token: null, data: null, editing: false, gisReady: false, onSignIn: null };
const app = document.getElementById('app');

// ---------- Tree IDs: 4 digits + Luhn check digit ----------
function luhn(payload) {
  let t = 0;
  payload.split('').reverse().forEach((c, i) => { let d = +c; if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } t += d; });
  return (10 - t % 10) % 10;
}
function validId(raw) {
  const s = String(raw || '').replace(/\D/g, '');
  return s.length === 5 && luhn(s.slice(0, 4)) === +s[4] ? s : null;
}
const label = id => id.slice(0, 4) + '-' + id.slice(4);
const treeUrl = id => CONFIG.BASE_URL.replace(/\/$/, '') + '/tree/' + id;

// ---------- Google sign-in (TUJP accounts only, checked by the backend) ----------
function tokenValid(t) {
  try {
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.exp * 1000 > Date.now() + 60000;
  } catch (e) { return false; }
}
// The sign-in token is kept in localStorage so a new tab (every NFC tap opens one) stays signed in
// until the token expires (about 1 hour). After that, browsers that signed in as staff before are
// signed in again automatically (Google auto sign-in), without a click.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
};
function loadToken() { const t = store.get('tujp_token'); return t && tokenValid(t) ? t : null; }
function saveToken(t) { store.set('tujp_token', t); }
function initGis() {
  if (!window.google || !google.accounts || !CONFIG.CLIENT_ID.includes('.apps.')) return;
  if (!state.gisReady) {
    google.accounts.id.initialize({
      client_id: CONFIG.CLIENT_ID,
      auto_select: true,
      cancel_on_tap_outside: false,
      callback: r => {
        store.set('tujp_signed_out', null);
        saveToken(r.credential); state.token = r.credential;
        if (state.onSignIn) state.onSignIn();
      }
    });
    state.gisReady = true;
    // Only browsers that were signed in as TUJP staff before get the automatic sign-in,
    // so public visitors never see a Google prompt.
    if (!state.token && store.get('tujp_staff') && !store.get('tujp_signed_out')) {
      google.accounts.id.prompt();
    }
  }
  const el = document.getElementById('gsi');
  if (el) google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
}
function signOut() {
  saveToken(null); state.token = null;
  store.set('tujp_signed_out', '1');
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  if (state.onSignIn) state.onSignIn();
}
function renderFooter(staffEmail) {
  if (staffEmail) store.set('tujp_staff', '1');
  document.getElementById('foot').innerHTML = staffEmail
    ? `<span class="muted">Signed in as ${esc(staffEmail)}</span> · <a href="#" onclick="signOut();return false">Sign out</a>`
    : `<p class="muted">TUJP staff</p><div id="gsi" style="display:inline-block"></div>`;
  initGis();
}

// ---------- Backend ----------
async function api(action, body) {
  const payload = Object.assign({ action, id: state.id, token: state.token }, body || {});
  const res = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('Network error ' + res.status);
  return res.json();
}
const ERRORS = {
  not_signed_in: 'Your sign-in expired. Sign in again.',
  already_registered: 'Someone already registered this tree. Reload the page.',
  too_many_reports: 'Too many reports for this tree right now. Try again later.',
  empty_message: 'Please describe what you noticed.',
  no_free_ids: 'There are no free IDs left in the register. Add more rows to the Trees tab.',
  sheet_layout: 'The Trees tab needs a tree_id and a status column.'
};
function check(r) { if (!r.ok) throw new Error(ERRORS[r.error] || ('Error: ' + r.error)); return r; }

// ---------- UI helpers ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function msg(text, error) { return `<div class="msg${error ? ' error' : ''}">${esc(text)}</div>`; }
function alertBox(text) { app.insertAdjacentHTML('afterbegin', msg(text, true)); window.scrollTo(0, 0); }
async function submitWith(btn, busyText, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = busyText;
  try { await fn(); } catch (e) { btn.disabled = false; btn.textContent = old; alertBox(e.message || String(e)); }
}
