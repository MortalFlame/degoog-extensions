# Screenshots

`1-card.png` here is a **generated brand card**, not a screenshot. It was produced by
`../../make-screenshots.py` and deliberately contains no real paper titles, DOIs, authors or
citation counts.

## Replacing it with a real capture

A genuine screenshot has to be taken from a running DeGoog instance. When you have one:

1. Delete `1-card.png`.
2. Drop in your own capture, numbered so it sorts first: `1-results.png`.
3. Keep the same 1200 x 750 size so the Store card does not jump.

## What the loader accepts

From `src/server/extensions/store/item-files.ts`:

```js
files.filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort()
```

So: **png, jpg, jpeg, gif, webp**, case-insensitive. **SVG is silently ignored.**

## Ordering matters — zero-pad filenames

The list is `.sort()`ed lexicographically and `item.screenshots[0]` becomes the Store card thumbnail
(`src/client/settings/store/render/item-card.tsx`). The rest appear in the lightbox.

```
screenshots/
├── 1-results.png      <- sorts first, becomes the thumbnail
├── 2-configure.png
└── 3-results-dark.png
```

Unpadded, `10-results.png` sorts *before* `2-configure.png`, so your tenth screenshot silently
becomes the thumbnail.

## Suggested specs for a real capture

| Use | Size | Notes |
|---|---|---|
| Card thumbnail | 1200 x 750 | 16:10, matches this card |
| Full screenshot | 1440 x 900 or wider | Frame the results page, not the browser window |
| Format | PNG | Lossless; JPG only for large flat images |

Keep each under ~400 KB so the Store stays quick to clone. Show a real query's results with the
engine tag visible.
