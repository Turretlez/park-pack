# Park Pack — Downtown Boston Dogs

A When2Meet-style app for downtown Boston dog owners.

- **Map**: a pocket map of downtown parks (Common, Public Garden, Esplanade, Post Office Sq, City Hall, Greenway, Columbus Park, Fort Point, Peters Park dog run). Pins show how many dogs pinged each park for a day; a time slider narrows it to who's there at, say, 5 PM. Dashed rings mark "regulars": dogs whose usual week and favorite parks line up.
- **Ping a park**: pick a park, day, and time window ("Leaving now, 1 hr" is one tap).
- **Find a time**: paint your usual free time on a weekly grid. The "Everyone" view stacks the pack's weeks into a heatmap, and "Best times" suggests windows plus a park.
- **Events**: dog-friendly events around Boston this week and coming up (dog bar nights, adoption days, markets that allow dogs), plus dog-friendly spots for any day. Edit `DOG_EVENTS` in `index.html` each week; past events drop off on their own.
- **Friends**: tap Add friend on a dog in the Pack tab, or share your friend link (`?friend=<uid>`). Friends get a yellow ring, a "Friends out today" list on the map, and a Friends-only map filter. People who added you show up under "Added you as a friend".
- **Friend alerts**: turn on in My dog. A notification when a friend adds a new ping, and nobody else. Without a push server these arrive while the app is open or was opened recently.
- **Location**: the locate button on the map shows a blue dot, the nearest park and a one-tap Check in. Coordinates never leave the phone; only the park you check in to is shared.
- **Pack**: every dog's card (size, how they do with other dogs, notes, next ping).

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app (HTML/CSS/JS, no build step) |
| `manifest.webmanifest`, `sw.js`, `icons/` | What makes it installable on iPhone and Android, and lets it open offline |
| `firebase-config.js` | Shared-pack backend config: Firebase project `park-pack-a7868`, free Spark plan (null = each phone keeps its own data) |
| `firestore.rules` | Firestore security rules: everyone reads, each phone writes only its own dog |
| `tools/make_icons.py` | Redraws the paw icons |
| `tools/make_qr_card.py` | Makes `park-pack-qr.png`, the QR card to share (opens the install screen via `?join`) |
| `tools/build_artifact.py` | Builds `dist/artifact.html`, the shared claude.ai preview |

## Where data lives

The same `index.html` runs three ways:
1. **Hosted with Firebase configured**: shared between all owners (anonymous sign-in per phone).
2. **Inside claude.ai** (the artifact): shared through the artifact's database.
3. **Neither**: saved on that phone only.

## Making it installable on phones

PWAs need to be served over HTTPS. To get a link people can install from:

1. Put this folder on any static host (GitHub Pages, Netlify, Cloudflare Pages — all free).
2. For a shared pack: create a Firebase project → add a Web app → enable **Authentication → Anonymous** and **Firestore**, paste the config into `firebase-config.js`, and publish `firestore.rules`.
3. Open the link on a phone:
   - **iPhone**: Safari → Share → Add to Home Screen.
   - **Android**: Chrome shows an Install prompt (or ⋮ → Install app).

After changing app files, bump `VERSION` in `sw.js` so installed phones pick up the update.

## Local preview

```bash
python -m http.server 5177
```
