// Park Pack lock-screen alerts.
// Runs every few minutes on GitHub Actions (free for public repos). It reads the pack,
// finds friend pings nobody has been told about yet, and sends a web push through
// Firebase Cloud Messaging to every phone that has friend alerts on.
//
// Needs the FIREBASE_SERVICE_ACCOUNT secret (the project's admin key JSON).
import admin from "firebase-admin";

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (!sa.private_key) { console.error("FIREBASE_SERVICE_ACCOUNT secret is missing."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const DRY = process.argv.includes("--dry");

// Pings are stored in Boston time.
const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(new Date()).map(p => [p.type, p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`;
const nowMin = (+parts.hour) * 60 + (+parts.minute);

const PARKS = {
  rowes: "Greenway Meetup", longwharf: "Long Wharf", columbus: "Columbus Park", ruff: "RUFF dog park", langone: "Langone Park",
  prado: "The Prado", northmeadow: "North Meadow", cityhall: "City Hall", pos: "Post Office Sq", dewey: "Dewey Sq",
  fortpoint: "Fort Point", common: "Common",
};
const parkName = id => PARKS[id] || "a park";
const fmt = m => { const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`; };
const dayLabel = d => {
  if (d === today) return "Today";
  const t = new Date(today + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 1);
  if (d === t.toISOString().slice(0, 10)) return "Tomorrow";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
const upcoming = p => p.date > today || (p.date === today && p.end > nowMin);
const live = p => p.date === today && p.start <= nowMin && nowMin < p.end;
// one place at a time: keep each dog's latest ping when times overlap
function oneAtATime(pings = []) {
  const kept = [];
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i];
    if (!kept.some(k => k.date === p.date && k.start < p.end && p.start < k.end)) kept.push(p);
  }
  return kept.reverse();
}

const [ownersSnap, pushSnap, stateSnap] = await Promise.all([
  db.collection("owners").get(), db.collection("push").get(), db.doc("meta/pushState").get(),
]);
const owners = {}; ownersSnap.forEach(d => { owners[d.id] = d.data(); });
const tokens = {}; pushSnap.forEach(d => { const t = d.data().token; if (t) tokens[d.id] = t; });
const state = stateSnap.exists ? stateSnap.data() : { sent: [], init: false };
const sent = new Set(state.sent || []);

const events = [];
for (const [uid, o] of Object.entries(owners)) {
  if (!o?.dog?.name) continue;
  for (const p of oneAtATime(o.pings)) {
    if (!p?.id || !upcoming(p)) continue;
    const k = `${uid}:${p.id}`, kh = k + ":here";
    if (p.here && live(p) && !sent.has(kh)) { sent.add(kh); sent.add(k); events.push({ uid, o, p, here: true }); }
    else if (!sent.has(k)) { sent.add(k); events.push({ uid, o, p, here: false }); }
  }
}

let sends = 0, dropped = 0;
if (!state.init) {
  console.log(`First run: marking ${events.length} existing pings as already announced.`);
} else {
  for (const ev of events) {
    const fans = Object.entries(owners)
      .filter(([uid, o]) => uid !== ev.uid && Array.isArray(o?.friends) && o.friends.includes(ev.uid) && tokens[uid])
      .map(([uid]) => uid);
    if (!fans.length) continue;
    const dog = ev.o.dog.name, park = parkName(ev.p.park);
    const title = ev.here ? `${dog} is at ${park}` : `${dog} is heading to ${park}`;
    const when = ev.here ? `There now until ${fmt(ev.p.end)}`
      : live(ev.p) ? `Now until ${fmt(ev.p.end)}` : `${dayLabel(ev.p.date)}, ${fmt(ev.p.start)}–${fmt(ev.p.end)}`;
    const body = when + (ev.p.note ? ` · ${ev.p.note}` : "");
    for (const uid of fans) {
      const msg = {
        token: tokens[uid],
        data: { title, body, tag: `${ev.uid}:${ev.p.id}${ev.here ? ":here" : ""}` },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      };
      if (DRY) { console.log("would send", uid.slice(0, 6), title, "|", body); continue; }
      try { await admin.messaging().send(msg); sends++; }
      catch (e) {
        const code = e?.errorInfo?.code || e?.code || "";
        console.warn("send failed", uid.slice(0, 6), code);
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) {
          await db.collection("push").doc(uid).delete().catch(() => {}); dropped++;
        }
      }
    }
  }
}

if (!DRY) await db.doc("meta/pushState").set({ sent: [...sent].slice(-3000), init: true, ranAt: new Date().toISOString() });
console.log(`${today} ${fmt(nowMin)} ET · ${events.length} new events · ${sends} pushes sent · ${dropped} dead tokens removed · ${Object.keys(tokens).length} phones registered`);
