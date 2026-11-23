/**
 * Park Pack backend (Google Apps Script, free).
 *  1. sendAlerts() runs every minute: finds friend pings/arrivals nobody was told about
 *     and sends lock-screen pushes through Firebase Cloud Messaging.
 *  2. doGet() is the private check-in link iPhone Shortcuts call on arrive/leave:
 *     ?a=arrive&park=rowes&u=<uid>&k=<key>   or   ?a=leave&u=<uid>&k=<key>
 *     The key lives in private/{uid}.checkinKey, which only that phone can read or write.
 * Runs as the project owner, so it reads/writes Firestore directly (no service account key).
 * Setup: run setup() once from the editor, then Deploy > Web app (Execute as: me, Access: Anyone).
 */
const PROJECT = 'park-pack-a7868';
const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const TZ = 'America/New_York';
const START = 6 * 60, LAST = 22 * 60;
const PARKS = {
  rowes: 'Greenway Meetup', longwharf: 'Long Wharf', columbus: 'Columbus Park', ruff: 'RUFF dog park', langone: 'Langone Park',
  prado: 'The Prado', northmeadow: 'North Meadow', cityhall: 'City Hall', pos: 'Post Office Sq', dewey: 'Dewey Sq',
  fortpoint: 'Fort Point', common: 'Common',
};

/* ---------- Firestore REST ---------- */
function call_(method, url, body) {
  const opt = {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT },
  };
  if (body) opt.payload = JSON.stringify(body);
  const r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode(), text = r.getContentText();
  if (code === 404) return null;
  if (code >= 300) throw new Error(method + ' ' + url.split('?')[0] + ' -> ' + code + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}
function toFs_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs_) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach(k => { if (v[k] !== undefined) f[k] = toFs_(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function fromFs_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs_);
  if ('mapValue' in v) return fields_(v.mapValue.fields);
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
function fields_(f) { const o = {}; Object.keys(f || {}).forEach(k => { o[k] = fromFs_(f[k]); }); return o; }
function getDoc_(path) { const d = call_('get', FS + '/' + path); return d ? fields_(d.fields) : null; }
function listDocs_(col) {
  const out = {}; let tok = '';
  do {
    const d = call_('get', FS + '/' + col + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    (d && d.documents || []).forEach(x => { out[x.name.split('/').pop()] = fields_(x.fields); });
    tok = d && d.nextPageToken || '';
  } while (tok);
  return out;
}
function patch_(path, obj) {
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return call_('patch', FS + '/' + path + '?' + mask, { fields: toFs_(obj).mapValue.fields });
}
function deleteDoc_(path) { call_('delete', FS + '/' + path); }

/* ---------- time + pings ---------- */
function now_() {
  const d = new Date();
  return { date: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), min: Number(Utilities.formatDate(d, TZ, 'H')) * 60 + Number(Utilities.formatDate(d, TZ, 'm')), iso: d.toISOString() };
}
const fmt_ = m => { const h = Math.floor(m / 60), mm = m % 60; return ((h + 11) % 12 + 1) + (mm ? ':' + ('0' + mm).slice(-2) : '') + ' ' + (h >= 12 ? 'PM' : 'AM'); };
function oneAtATime_(pings) {
  const kept = [];
  for (let i = (pings || []).length - 1; i >= 0; i--) {
    const p = pings[i];
    if (!kept.some(k => k.date === p.date && k.start < p.end && p.start < k.end)) kept.push(p);
  }
  return kept.reverse();
}
function dayLabel_(d, t) {
  if (d === t.date) return 'Today';
  const tm = Utilities.formatDate(new Date(Date.now() + 86400000), TZ, 'yyyy-MM-dd');
  if (d === tm) return 'Tomorrow';
  return Utilities.formatDate(new Date(d + 'T12:00:00Z'), 'UTC', 'EEE MMM d');
}

/* ---------- 1. lock-screen alerts ---------- */
function sendAlerts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 'busy';
  try {
    const t = now_();
    const upcoming = p => p.date > t.date || (p.date === t.date && p.end > t.min);
    const live = p => p.date === t.date && p.start <= t.min && t.min < p.end;
    const owners = listDocs_('owners'), push = listDocs_('push');
    const tokens = {}; Object.keys(push).forEach(u => { if (push[u].token) tokens[u] = push[u].token; });
    const state = getDoc_('meta/pushState') || { sent: [], init: false };
    const sent = {}; (state.sent || []).forEach(k => { sent[k] = 1; });
    const fresh = [];
    Object.keys(owners).forEach(uid => {
      const o = owners[uid]; if (!o || !o.dog || !o.dog.name) return;
      oneAtATime_(o.pings || []).forEach(p => {
        if (!p || !p.id || !upcoming(p)) return;
        const k = uid + ':' + p.id, kh = k + ':here';
        if (p.here && live(p) && !sent[kh]) { sent[kh] = sent[k] = 1; fresh.push({ uid: uid, o: o, p: p, here: true }); }
        else if (!sent[k]) { sent[k] = 1; fresh.push({ uid: uid, o: o, p: p, here: false }); }
      });
    });
    let sends = 0;
    if (state.init) {
      fresh.forEach(ev => {
        const fans = Object.keys(owners).filter(u => u !== ev.uid && tokens[u] && (owners[u].friends || []).indexOf(ev.uid) >= 0);
        if (!fans.length) return;
        const dog = ev.o.dog.name, park = PARKS[ev.p.park] || 'a park';
        const title = ev.here ? dog + ' is at ' + park : dog + ' is heading to ' + park;
        const when = ev.here ? 'There now until ' + fmt_(ev.p.end)
          : live(ev.p) ? 'Now until ' + fmt_(ev.p.end) : dayLabel_(ev.p.date, t) + ', ' + fmt_(ev.p.start) + '–' + fmt_(ev.p.end);
        const body = when + (ev.p.note ? ' · ' + ev.p.note : '');
        fans.forEach(u => { if (fcm_(u, tokens[u], title, body, ev.uid + ':' + ev.p.id + (ev.here ? ':here' : ''))) sends++; });
      });
    }
    patch_('meta/pushState', { sent: Object.keys(sent).slice(-3000), init: true, ranAt: t.iso });
    return fresh.length + ' new, ' + sends + ' sent';
  } finally { lock.releaseLock(); }
}
function fcm_(uid, token, title, body, tag) {
  const r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT + '/messages:send', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT },
    payload: JSON.stringify({ message: { token: token, data: { title: title, body: body, tag: tag }, webpush: { headers: { Urgency: 'high', TTL: '3600' } } } }),
  });
  const code = r.getResponseCode();
  if (code < 300) return true;
  const text = r.getContentText();
  console.warn('fcm ' + uid.slice(0, 6) + ' ' + code + ' ' + text.slice(0, 200));
  if (code === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text)) { try { deleteDoc_('push/' + uid); } catch (e) {} }
  return false;
}

/* ---------- 2. iPhone Shortcuts check-in link ---------- */
function doGet(e) {
  const q = e && e.parameter || {};
  let msg;
  try { msg = checkin_(q); } catch (err) { console.error(err); msg = 'Park Pack had a problem: ' + err.message; }
  return ContentService.createTextOutput(msg);
}
function checkin_(q) {
  const uid = String(q.u || ''), key = String(q.k || ''), action = String(q.a || '');
  if (!/^[A-Za-z0-9]{10,64}$/.test(uid) || key.length < 16) return 'Link is incomplete. Copy it again from Park Pack.';
  const priv = getDoc_('private/' + uid);
  if (!priv || !priv.checkinKey || priv.checkinKey !== key) return 'This check-in link is no longer valid. Copy a new one from Park Pack.';
  const me = getDoc_('owners/' + uid);
  if (!me || !me.dog || !me.dog.name) return 'Add your dog in Park Pack first.';
  const t = now_();
  let pings = (me.pings || []).filter(p => p && (p.date > t.date || (p.date === t.date && p.end > t.min - 1)));
  const live = p => p.date === t.date && p.start <= t.min && t.min < p.end;
  let reply;
  if (action === 'leave') {
    const cur = pings.filter(p => live(p) && p.here);
    if (!cur.length) return me.dog.name + " wasn't checked in anywhere.";
    cur.forEach(p => { if (t.min - p.start >= 5) { p.end = t.min; delete p.here; } else pings = pings.filter(x => x !== p); });
    reply = 'Checked ' + me.dog.name + ' out of ' + (PARKS[cur[0].park] || 'the park') + '.';
  } else if (action === 'arrive') {
    const park = String(q.park || '');
    if (!PARKS[park]) return 'Unknown park in this link.';
    if (t.min < START || t.min >= LAST - 5) return 'Check-ins run 6 AM to 10 PM.';
    const cur = pings.find(p => live(p) && p.park === park);
    if (cur) { cur.here = true; cur.end = Math.max(cur.end, Math.min(LAST, t.min + 120)); }
    else {
      const start = Math.floor(t.min / 5) * 5, end = Math.min(LAST, start + 120);
      pings = pings.filter(p => !(p.date === t.date && p.start < end && start < p.end));   // one place at a time
      pings.push({ id: Utilities.getUuid().replace(/-/g, '').slice(0, 8), date: t.date, park: park, start: start, end: end, here: true, auto: true });
    }
    reply = me.dog.name + ' is checked in at ' + PARKS[park] + '. Friends are being told.';
  } else return 'Unknown action.';
  patch_('owners/' + uid, { pings: pings.slice(-40), updatedAt: t.iso });
  try { sendAlerts(); } catch (err) { console.error(err); }
  return reply;
}

/* ---------- one-time setup ---------- */
function setup() {
  ScriptApp.getProjectTriggers().forEach(tr => ScriptApp.deleteTrigger(tr));
  ScriptApp.newTrigger('sendAlerts').timeBased().everyMinutes(1).create();
  return sendAlerts();
}
