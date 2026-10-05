# degoog-extensions

Personal [DeGoog](https://github.com/degoog-org/degoog) extensions: eight search engines and three
outgoing-request transports. Published as a **DeGoog Store repository** so an instance can install and
update them from the Store instead of hand-copying files into `data/`.

---

## Using this repo on a DeGoog instance

1. **Settings → Store → Repositories → Add**, and enter the clone URL:

   ```
   https://github.com/mortalflame/degoog-extensions.git
   ```

2. **Settings → Store → Engines / Transports**, pick what you want, **Install**.

3. Configure each engine in **Settings → Engines → Configure**.

That is all. Degoog clones the repo into `data/store/`, copies each installed item into
`data/engines/` or `data/transports/`, and offers **Update** in the Store whenever you push a
change here.

### Canonical IDs change on install

Installed folders are named `{github-owner}-{repo-name}-{item-folder}`, so the canonical IDs become:

| Item | Installed ID |
|---|---|
| `engines/openalex` | `mortalflame-degoog-extensions-openalex-engine` |
| `transports/cloakbrowser-vercel` | `mortalflame-degoog-extensions-cloakbrowser-vercel-transport` |

and so on for the rest. Anything previously stored under a hand-placed folder name
(`openalex-engine`, `cloakbrowser-vercel-transport`) is orphaned and must be re-entered once.

**Only preferences are affected — no API keys are lost.** Every engine and transport here reads its
credentials from environment variables, and none of them declares a key or `password` field in its
`settingsSchema`. What gets re-entered is: `safeSearch`, `region`, `searchDepth`, and the transport
`timeout` / `waitUntil` / `extraWaitMs` / `bypassProxy` / `mode` values.

---

## Credentials

All credentials come from environment variables on the DeGoog host. Nothing here contains a secret,
and nothing secret should ever be committed to this repository.

| Variable | Used by |
|---|---|
| `FIRECRAWL_API_KEY` | Firecrawl, Firecrawl Research |
| `LOBSTR_API_KEY`, `LOBSTR_GOOGLE_SQUID` | Lobstr |
| `OPENALEX_API_KEY` | OpenAlex |
| `SEMANTIC_SCHOLAR_API_KEY` | Semantic Scholar |
| `SERPING_API_KEY` | SerpApi |
| `SERPSTACK_API_KEY` | SerpStack |
| `TAVILY_API_KEY` | Tavily |
| `CLOAKBROWSER_VERCEL_URL`, `CLOAKBROWSER_VERCEL_TOKEN`, `VERCEL_BYPASS_SECRET` | CloakBrowser Vercel |
| `SCRAPE_DO_TOKEN` | Scrape.do |
| `BROWSERLESS_TOKEN` | Browserless (QL) — plus its `url` setting, entered in the UI |

> Rotating any of these does **not** invalidate cached search results. Degoog's engine cache key
> fingerprints stored plugin settings, not environment variables. Clear the cache from Settings after
> rotating a key.

> The CloakBrowser Vercel transport still appears in the transport picker when its variables are
> missing — Degoog core never calls a transport's `available()` hook — and then returns HTTP 503 for
> every query. A sudden Startpage/Ecosia outage usually means one of those three variables is unset.

---

## Screenshots

Every item folder has a `screenshots/1-card.png`. These are **generated brand cards, not
screenshots** — a real capture has to come from a running DeGoog instance. The cards deliberately
contain no real paper titles, DOIs, authors or citation counts, because inventing them on a public
page about scholarly search would be genuinely harmful. Five of them composite the vendor's official
logo; the other six use generated abstract geometry.

### What the loader accepts

From `src/server/extensions/store/item-files.ts`:

```js
files.filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort()
```

**png, jpg, jpeg, gif, webp**, case-insensitive. **SVG is silently ignored.**

### Ordering — zero-pad filenames

The list is `.sort()`ed lexicographically and `item.screenshots[0]` becomes the card thumbnail
(`src/client/settings/store/render/item-card.tsx`). Everything else goes in the lightbox. Always
zero-pad: unpadded, `10-results.png` sorts *before* `2-configure.png` and silently becomes the
thumbnail.

### Specs for a real capture

| Use | Size |
|---|---|
| Card thumbnail | 1200 x 750 (16:10, what the generated cards use) |
| Full screenshot | 1440 x 900 or wider |

PNG preferred; keep each under ~400 KB. Show a real query's results with the engine tag visible.

### Regenerating the cards

```bash
python3 make-screenshots.py --brand-dir brand
```

The script has no third-party dependencies — it decodes and encodes PNG by hand and draws text with
a built-in 5x7 bitmap font, so it runs anywhere Python 3 does.

**No third-party images are bundled or used.** Every card is generated from scratch, so there is no
licence to honour and no attribution to publish. Engine cards get neutral result-row geometry;
transport cards get a stylised page being fetched. Neither contains legible text, so nothing can be
mistaken for a real citation.

If you later obtain a logo you are entitled to use, put it in the folder named by `--brand-dir`,
named after the item key (`firecrawl.png`, `openalex.png`, …) and re-run — it will be composited
onto the card, with a light or dark backing tile chosen from the logo's own luminance. Items with no
logo fall back to the generated art automatically.

### Per-item author

`author.json` inside an item folder overrides the repo-wide `author` for that item, and is where an
avatar goes:

```json
{
  "name": "Your Name",
  "url": "https://github.com/mortalflame",
  "avatar": "https://example.com/avatar.png"
}
```

### Repo logo

Drop a `logo.png` in the repo root and add `"repo-image": "logo.png"` to `package.json`. It shows next
to the repository in Settings -> Store.

> Note: `author.json` and `screenshots/` are **stripped when an item is installed**
> (`STORE_METADATA` in `item-files.ts`). That is expected — the Store reads them from the repo, and
> the installed copy stays small.

---

## Repository layout

```
degoog-extensions/
├── package.json                  ← required; the Store catalogue
├── engines/<slug>/index.js
└── transports/<slug>/index.js
```

Each item folder uses exactly the same format as when installed directly into `data/` — there is no
extra packaging. An entry file must be named `index.js`, `index.ts`, `index.mjs` or `index.cjs` and
nothing else; a differently-named entry silently fails to load.

Only items listed in `package.json` appear in the Store, and each `path` must match the folder on disk.

---

## Notes for maintainers

- Engines must call `context.sentinel(response, name)` before parsing, and **throw** rather than
  returning `[]` on a block page. Degoog caches empty results for the full 12-hour TTL, so an engine
  that quietly returns nothing on a captcha stays broken for half a day while reporting a green status.
- Route outgoing requests through `context.fetch` so per-engine transport selection and proxy settings
  apply. A module-level `export const type` is what creates the results tab.
- `context.engineError(status, …)` only accepts `"parse_error"` and `"timeout"` as real threat levels.
  Other strings work today but are not part of the enum.
- The extensions are deliberately dependency-free: nothing imports from DeGoog internals, so upgrades
  of the core cannot break them.
