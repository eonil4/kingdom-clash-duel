# Arena fight practice

Node tooling for Kingdom Clash arena enemy screenshots: OCR / local vision LLM extraction into `scripts/fileMap.json` and WebP assets.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/)

## Setup

```bash
pnpm install
```

Native addons (**sharp**, **tesseract.js**, **esbuild**) may compile on first install; builds are allowed in `pnpm-workspace.yaml` (`allowBuilds`).

## Commands

| Command | Description |
|--------|-------------|
| `pnpm test:unit` | Vitest (single run) |
| `pnpm test:unit:watch` | Vitest watch mode |
| `pnpm run ci` | Unit tests |

## Enemy OCR and asset scripts

Scripts read **`scripts/fileMap.json`**, discover directories under that tree that exist on disk and contain images, then OCR screenshots (top-right opponent name + power). When the source file is named **`XXX_XXX_XXX-<slug>.png`** (nine-digit power in three groups), that power is taken from the filename and OCR power is only used as a fallback or mismatch warning. If **`slug`** contains **`%HH`** percent escapes (same scheme as canonical filenames), that slug is decoded and used as the **Latin label** and canonical **`.webp`** name; OCR still supplies Cyrillic **`name`** when it finds Cyrillic text. Outputs are written back into `fileMap.json` under nested keys: **`<folder>/<originalBasename>/<canonical>.webp`**.

Reserved characters in Windows filenames (`<>:"'/\\|?*`) are percent-encoded in the canonical basename (for example `\` → `%5C`).

| Command | Description |
|--------|-------------|
| `pnpm ocr:enemy` | Main pipeline: OCR images → update `scripts/fileMap.json` |
| `pnpm ocr:enemies` | Same as `ocr:enemy` |
| `pnpm ocr:enemy:power` | OCR power only (CLI: image path) |
| `pnpm ocr:enemy:name` | OCR name only (CLI: image path) |
| `pnpm ocr:enemy:latin` | Transliterate / Latin tokens from text (CLI args) |
| `pnpm llm:convert:webp` | From map: create `.webp` beside originals if missing |
| `pnpm ocr:enemies:process` | Runs `ocr:enemies` then `llm:convert:webp` |
| `pnpm llm:convert` | LM Studio vision → WebP + `fileMap.json` |
| `pnpm llm:show-llm-config` | Print resolved LLM host / model / cache settings |

### Local vision LLM (LM Studio)

For `convert.js` / `llm-enemy-extract.mjs`, use [LM Studio](https://lmstudio.ai/) with a loaded vision model on port **1234**:

```bash
set LLM_MODEL=qwen/qwen3-vl-4b
set LLM_HOST=http://127.0.0.1:1234
pnpm llm:convert
```

`convert.js` skips PNGs that already have a canonical WebP (per `fileMap.json`). Use `--force` to re-run LLM and overwrite. Failed LLM calls retry per `config/llm.json`.

Pass arguments to Node after `--`:

```bash
pnpm ocr:enemy -- --only test.png --force-ocr
pnpm ocr:enemy:power -- data/enemies/2026-05-08/test/test.png
pnpm ocr:enemy:latin -- "Бабка\\MAG"
pnpm llm:convert:webp -- --dry-run
pnpm ocr:enemies:process
```

Common flags for **`ocr:enemy`** / **`ocr-enemy.mjs`**: `--out`, `--only`, `--limit`, `--debug-crops`, `--force-ocr`.

To **rename or convert sources** onto canonical names (and drop PNG/JPEG after convert), run `node scripts/llm/rename-enemies.mjs` (`--skip-ocr` if the map is already fresh).

Crop a rectangle from an image:

```bash
node scripts/extract_image.mjs <input> <output> <x> <y> <width> <height>
```

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

- `scripts/` — Enemy OCR, LLM convert, `fileMap.json`, WebP helpers
- `config/` — LLM settings (`llm.json`)
- `tests/unit/` — Vitest unit tests
- `data/enemies/` — Enemy images (by date / folder)

## License

Private package (`"private": true` in `package.json`).
