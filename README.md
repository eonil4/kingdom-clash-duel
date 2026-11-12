# Arena fight practice

Node tooling for Kingdom Clash arena enemy screenshots: OCR / local vision LLM extraction into per-folder `data/clan_clash/**/data.json` and WebP assets.

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

Scripts use per-folder **`data.json`** as the only store: `data/clan_clash/YYYY-MM-DD/data.json` maps each source screenshot to its canonical `.webp`. OCR scans those date folders (subfolders such as `clan/`, `victory/`, `duel/` are not arena panels) and records results back into the same `data.json`. When the source file is named **`XXX_XXX_XXX-<slug>.png`** (nine-digit power in three groups), that power is taken from the filename and OCR power is only used as a fallback or mismatch warning. If **`slug`** contains **`%HH`** percent escapes (same scheme as canonical filenames), that slug is decoded and used as the **Latin label** and canonical **`.webp`** name; OCR still supplies Cyrillic **`name`** when it finds Cyrillic text.

Reserved characters in Windows filenames (`<>:"'/\\|?*`) are percent-encoded in the canonical basename (for example `\` → `%5C`).

| Command | Description |
|--------|-------------|
| `pnpm ocr:enemy` | Main pipeline: OCR images → update per-folder `data.json` |
| `pnpm ocr:enemy:power` | OCR power only (CLI: image path) |
| `pnpm ocr:enemy:name` | OCR name only (CLI: image path) |
| `pnpm ocr:enemy:latin` | Transliterate / Latin tokens from text (CLI args) |
| `pnpm llm:convert:webp` | From map: create `.webp` beside originals if missing |
| `pnpm ocr:enemies:process` | Runs `ocr:enemy` then `llm:convert:webp` |
| `pnpm ocr:rename-enemies` | Rename/convert sources onto canonical names |
| `node scripts/llm/convert.mjs <folder>` | Extract → WebP + `data.json` (`--extractor llm\|ocr`, `--mode crops\|screenshot`) |
| `pnpm llm:show-llm-config` | Print resolved LLM host / model / cache settings |

### Local vision LLM (LM Studio)

For `convert.mjs` / `llm-enemy-extract.mjs`, use [LM Studio](https://lmstudio.ai/) with a loaded vision model on port **1234**:

```bash
set LLM_MODEL=qwen/qwen3-vl-8b
set LLM_HOST=http://127.0.0.1:1234
pnpm llm:convert
```

`convert.mjs` skips PNGs that already have a canonical WebP (per folder `data.json`). Use `--force` to re-run extraction and overwrite. Failed LLM calls retry per `config/llm.json`. Two extraction strategies: `--extractor llm` (default; `--mode crops` for name + power ROI crops, `--mode screenshot` for the whole screenshot) and `--extractor ocr` (local tesseract, no LM Studio needed; `--mode` is ignored). Both share the same runner, so OCR runs also produce the canonical WebP and timed `data.json` entries.

Pass arguments to Node after `--`:

```bash
pnpm ocr:enemy -- --only test.png --force-ocr
pnpm ocr:enemy:power -- data/clan_clash/2026-11-06/<image>.png
pnpm ocr:enemy:latin -- "Бабка\\MAG"
pnpm llm:convert:webp -- --dry-run
pnpm ocr:enemies:process
```

Common flags for **`ocr:enemy`** / **`ocr-enemy.mjs`**: `--only`, `--limit`, `--debug-crops`, `--force-ocr`.

To **rename or convert sources** onto canonical names (and drop PNG/JPEG after convert), run `pnpm ocr:rename-enemies` (`--skip-ocr` if the map is already fresh).

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

- `scripts/` — Enemy OCR, LLM convert, WebP helpers
- `config/` — LLM settings (`llm.json`)
- `tests/unit/` — Vitest unit tests
- `data/clan_clash/` — Clan clash images + per-folder `data.json`
- `data/enemies/` — Enemy images (by date / folder)

## License

Private package (`"private": true` in `package.json`).
