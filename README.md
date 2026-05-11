# Arena fight practice

React + TypeScript app for arena combat practice, built with Vite. Enemy screenshots can be processed with Node scripts (Sharp + Tesseract) into a structured `fileMap.json` and WebP assets.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/)

## Setup

```bash
pnpm install
```

Native addons (**sharp**, **tesseract.js**) may compile on first install; `package.json` lists them under `pnpm.onlyBuiltDependencies`.

## App commands

| Command | Description |
|--------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Typecheck and production build |
| `pnpm preview` | Preview production build |
| `pnpm lint` | ESLint |
| `pnpm test:unit` | Vitest (single run) |
| `pnpm test:unit:watch` | Vitest watch mode |
| `pnpm example:run` | Run example battle execution test |
| `pnpm ci` | Lint, build, and unit tests |

## Enemy OCR and asset scripts

Scripts read **`scripts/fileMap.json`**, discover directories under that tree that exist on disk and contain images, then OCR screenshots (top-right opponent name + power). When the source file is named **`XXX_XXX_XXX-<slug>.png`** (nine-digit power in three groups), that power is taken from the filename and OCR power is only used as a fallback or mismatch warning. If **`slug`** contains **`%HH`** percent escapes (same scheme as canonical filenames), that slug is decoded and used as the **Latin label** and canonical **`.webp`** name; OCR still supplies Cyrillic **`name`** when it finds Cyrillic text. Outputs are written back into `fileMap.json` under nested keys: **`<folder>/<originalBasename>/<canonical>.webp`**.

Reserved characters in Windows filenames (`<>:"'/\\|?*`) are percent-encoded in the canonical basename (for example `\` → `%5C`).

| Command | Description |
|--------|-------------|
| `pnpm ocr:enemy` | Main pipeline: OCR images → update `scripts/fileMap.json` |
| `pnpm ocr:enemies` | Same as `ocr:enemy` (alias for older docs / scripts) |
| `pnpm ocr:enemy:power` | OCR power only (CLI: image path) |
| `pnpm ocr:enemy:name` | OCR name only (CLI: image path) |
| `pnpm enemy:latin` | Transliterate / Latin tokens from text (CLI args) |
| `pnpm convert:webp` | From map: create `.webp` beside originals if missing (keeps sources) |
| `pnpm enemies:process` | Runs `ocr:enemies` then `convert:webp` (refresh map, then create missing WebPs) |

Pass arguments to Node after `--`:

```bash
pnpm ocr:enemy -- --only test.png --force-ocr
pnpm ocr:enemy:power -- data/enemies/2026-05-08/test/test.png
pnpm enemy:latin -- "Бабка\\MAG"
pnpm convert:webp -- --dry-run
pnpm enemies:process
```

Common flags for **`ocr:enemy`** / **`ocr-enemy.mjs`**: `--out`, `--only`, `--limit`, `--debug-crops`, `--force-ocr`.

To **rename or convert sources** onto canonical names (and drop PNG/JPEG after convert), run `node scripts/rename-enemies.mjs` (`--skip-ocr` if the map is already fresh).

### `test/` fixture folders

In directories named **`test`**, only **`test.png`** and **`Screenshot_*`** files are treated as full screenshots. Other small PNGs (for example name/power crops or `%`-encoded reference filenames) can be used to refine OCR for that folder.

### Map layout example

```json
{
  "data": {
    "enemies": {
      "2026-05-08": {
        "test": {
          "test.png": {
            "002_295_202-Babka%5CMAG.webp": {
              "name": "Бабка\\MAG",
              "nameLatin": "Babka\\MAG",
              "power": 2295202
            }
          }
        }
      }
    }
  }
}
```

On disk, sources stay in **`data/enemies/2026-05-08/test/`** next to generated **`*.webp`** files.

## Project layout (high level)

- `src/` — React app (features, components, store, pages)
- `scripts/` — Enemy OCR, `fileMap.json`, WebP conversion
- `tests/unit/` — Vitest unit tests
- `data/enemies/` — Example enemy images (by date / folder)

## License

Private package (`"private": true` in `package.json`).
