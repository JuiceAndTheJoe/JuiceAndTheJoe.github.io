# Adding links to The Node from your phone (M3)

Two capture surfaces talk to the same Worker endpoint
(`POST https://satellite-proxy.esvela02.workers.dev/add-link`, see
`worker/ADD-LINK-SETUP.md`):

1. **iOS Share-Sheet Shortcut** — primary, lowest friction (Share → tap → done).
2. **Web form / PWA** (`node/add.html`) — cross-platform fallback, also installable
   to your home screen.

A third, **zero-Worker** path (GitHub Issue → Action) is documented at the bottom
as a possible future addition — it is **not built**.

---

## 1. iOS Share-Sheet Shortcut (primary)

Builds a "Add to The Node" action that appears in Safari's Share sheet. The
`NODE_SECRET` lives only inside the Shortcut — never in the repo.

### Build it (one-time, ~5 min)

1. Open **Shortcuts** → **+** (new shortcut) → name it **Add to The Node**.
2. Tap the **ⓘ** (settings) → enable **Show in Share Sheet**. Under *Accept*,
   keep **URLs** (and **Safari web pages**) on.
3. Add action **Get URLs from Input** (its input = *Shortcut Input*). This pulls
   the shared page URL.
4. *(Category dropdown — recommended)* Add a pick-list so you choose the board
   each time:
   - Add action **List** → *Add new item* for each of these exact category ids
     (one per line): `inbox`, `social`, `employers`, `inspiration`, `thesis`.
   - Add action **Choose from List** → input = the **List** above; set
     **Prompt** to `Pin to which board?`; leave *Select Multiple* off. Its output
     is the **Chosen Item** variable.
   - Skip this step to always use `inbox`.
   - Use the **ids** as the list items — that's what the Worker keys on. (An
     unknown value would just fall back to `inbox`, never an invisible card.)
5. Add action **Get Contents of URL**:
   - **URL:** `https://satellite-proxy.esvela02.workers.dev/add-link`
   - Expand **Show More**:
     - **Method:** `POST`
     - **Headers:** add two —
       - `X-Node-Secret` → *your NODE_SECRET value*
       - `Content-Type` → `application/json`
     - **Request Body:** **JSON**, with fields:
       - `url` (Text) → the **URLs** variable from step 3
       - `category` (Text) → the **Chosen Item** variable from step 4
         (or just type `inbox` if you skipped the dropdown)
       - `note` (Text) → leave empty, or insert **Ask Each Time**
6. *(Nice feedback)* Add **Get Dictionary Value** → `title` from the
   *Contents of URL* result, then **Show Notification** with text
   `Pinned: <Dictionary Value>`.
7. **Done.** Now from Safari: **Share → Add to The Node**. The card shows up on
   `/node/` within ~1–2 minutes.

### Notes
- If you get a notification with an error, the most common cause is a wrong
  `NODE_SECRET` (401) — edit the header in the Shortcut.
- The Worker scrapes the page title / description / preview image itself, so you
  only ever need to pass the URL.

---

## 2. Web form / PWA (`node/add.html`)

Works on any device, and is the fallback if the iOS Shortcut ever breaks.

1. On your phone, open `https://juiceandthejoe.github.io/node/add.html`.
2. First run asks for your **Node key** (the `NODE_SECRET`). It is saved to that
   browser's `localStorage` only — not committed anywhere. Tap **forget key** to
   clear it.
3. Paste a URL, optionally pick a category and add a note, tap **Pin it**.
4. **Install to home screen** (iOS Safari: Share → *Add to Home Screen*; Android
   Chrome: menu → *Install app*) to get an app-like launcher backed by
   `manifest.json`.

The form also accepts a prefilled URL via `add.html?url=https://…`, so it can be
wired as an Android share target or a bookmarklet later.

---

## 3. Future fallback — GitHub Issue → Action (NOT built)

A zero-Worker capture path, kept here as an option if the Worker/Shortcut route
ever needs a backup:

- Add `.github/ISSUE_TEMPLATE/add-link.yml` (an Issue Form with `url`,
  `category`, `note` fields).
- Add `.github/workflows/parse-link-issue.yml` triggered on
  `issues: [opened]` with the `add-link` label: it parses the issue body,
  appends the link to `node/links.json` using the built-in `GITHUB_TOKEN`
  (no PAT needed), commits, and closes the issue.

Trade-offs vs. the Worker path: no secrets/Worker to maintain, but capture is
clunkier (open GitHub app → new issue → fill form), latency is ~1–3 min, no
automatic title/preview scraping, and issues need auto-closing to avoid clutter.
