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

## Adding screenshots and per-item author details

Neither is required, but both make the Store card look right.

**Screenshots.** Create `screenshots/` inside an item folder and drop in `.png`, `.jpg`, `.jpeg`,
`.gif` or `.webp` files. The **first file alphabetically** becomes the card thumbnail; the rest show in
the lightbox. SVG is filtered out by the loader, so use a raster image.

```
engines/serpstack/
├── index.js
└── screenshots/
    ├── 1-results.png        ← card thumbnail (sorts first)
    └── 2-configure.png
```

**Per-item author.** `author.json` inside an item folder overrides the repo-wide `author` for that
item, and is where you add an avatar:

```json
{
  "name": "Your Name",
  "url": "https://github.com/mortalflame",
  "avatar": "https://example.com/avatar.png"
}
```

**Repo logo.** Drop a `logo.png` in the repo root and add `"repo-image": "logo.png"` to
`package.json`. It shows next to the repository in Settings → Store.

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
