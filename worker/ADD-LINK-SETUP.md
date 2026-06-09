# The Node — `/add-link` endpoint setup (M2)

The `satellite-proxy` Worker now also serves `POST /add-link`, which appends a
pinned link to `node/links.json` via the GitHub Contents API. Two secrets must be
set before it works. They live only as Worker secrets — never in the repo.

## 1. Create a fine-grained GitHub PAT

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new:

- **Resource owner:** `JuiceAndTheJoe`
- **Repository access:** Only select repositories → `JuiceAndTheJoe.github.io`
- **Permissions:** Repository permissions → **Contents: Read and write** (nothing else)
- **Expiration:** 1 year (set a reminder to rotate)

Copy the `github_pat_…` value.

## 2. Pick a shared secret

Any long random string the caller will echo in the `X-Node-Secret` header, e.g.:

```sh
openssl rand -hex 24
```

## 3. Store both as Worker secrets

```sh
cd worker
wrangler secret put GITHUB_PAT     # paste the github_pat_… value
wrangler secret put NODE_SECRET    # paste the random string from step 2
```

## 4. Deploy

```sh
wrangler deploy
```

The endpoint is then live at: `https://satellite-proxy.<your-subdomain>.workers.dev/add-link`
(same host as the existing Mapbox proxy — check `wrangler deploy` output for the URL).

## 5. Test it

```sh
curl -X POST https://satellite-proxy.<subdomain>.workers.dev/add-link \
  -H "X-Node-Secret: <your NODE_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.gnu.org/", "category":"inspiration", "note":"test pin"}'
```

Expect `200 {"ok":true,"id":"…","title":"…"}`. The link is committed to
`node/links.json`; GitHub Pages redeploys and the clue card appears on
`/node/` within ~1–2 minutes.

## Request contract

`POST /add-link`, JSON body:

| field      | required | notes |
|------------|----------|-------|
| `url`      | yes      | http(s) URL. Title/description/og-image are scraped from the page. |
| `note`     | no       | Overrides the scraped description. |
| `category` | no       | One of the category ids in `links.json` (`social`, `employers`, `inspiration`, `thesis`, `inbox`). Defaults to `inbox`. |

New links are stored with `status: "inbox"` and empty `tags` — curate later by
editing `links.json`.

`POST /delete-link`, JSON body:

| field | required | notes |
|-------|----------|-------|
| `id`  | yes      | The `id` of the link to remove from `links.json`. Returns 404 if no match. |

Both endpoints use the same `X-Node-Secret` header and rate limit.

## Adding / deleting from the board UI

Once the Worker is deployed, the board itself (`/node/`) can add and delete
clues — no need for `add.html`:

- Click **🔒 admin** (bottom-right) and paste your `NODE_SECRET` once (stored in
  that browser's `localStorage`, same as `add.html`).
- **➕ new clue** opens an add form; each clue's detail overlay gets a **remove**
  button. Both call the Worker, which commits to `links.json`.
- The board updates optimistically; the live site catches up on the next Pages
  rebuild (~1–2 min). **🔓 lock** clears the key.

Visitors without the key only ever see a read-only board — the Worker rejects any
add/delete lacking the correct `X-Node-Secret`.

## Behaviour / safeguards

- **401** if `X-Node-Secret` is missing or wrong.
- **429** if more than 5 adds/minute from one IP (reuses the existing
  `bumpRateLimit` Cache-API limiter — no KV writes).
- **400** for a non-JSON body or a non-http(s) URL.
- Metadata scrape is best-effort with a 6s timeout: if the page can't be fetched,
  the link is still added with the URL, a Google favicon, and your `note`.

## Rotating a leaked secret

`wrangler secret put NODE_SECRET` (and update the iOS Shortcut / `add.html`) — or
`wrangler secret put GITHUB_PAT` with a freshly minted token. Blast radius of a
leak is limited to appending to one JSON file in one repo.
