# Script Folder Analysis — `scripts/`

**Revision:** 2026-11-12
**Scope:** `scripts/**` — 29 source files, 6,406 lines (excluding generated HTML/JSON and `node_modules`).
**Method:** every file read in full; relative-import resolution verified mechanically; `pnpm test:unit` executed; behavior checked against `package.json`, `config/llm.json`, `vitest.config.ts`, `README.md`.

---

## 1. What the folder actually does

Three independent pipelines live under `scripts/`:

```
A. Screenshot → enemy/clan records → canonical .webp
   OCR path:   ocr/ocr-enemy.mjs ──tesseract──┐
   LLM path:   llm/llm-enemy-extract.mjs      ├→ data/clan_clash/**/data.json
               llm/llm-formation-extract.mjs  │   (per-folder store, merged by
               llm/convert.mjs ───────────────┘    file-map-enemies.mjs)
                       ↓ sharp
               <power>-<name>.webp  (Windows-safe, percent-encoded)

B. Folder → HTML gallery
   generate-wiki-table.mjs   (one image per row, remote raw.githubusercontent URLs)
   generate-wiki-matrix.mjs  (duel matrix split on `#`; two views + zoom toolbar)

C. Armies → deterministic battle report
   battle/run-battle.mjs → load-apk-config → army-resolver → combat-engine → clash-score
```

| Area | Files | LOC | Entry points |
|---|---:|---:|---|
| `llm/` | 11 | 2,701 | `clan-clash.mjs` (orchestrator), `convert.mjs --mode`, `vision-client.mjs` + `llm-*-extract.mjs` descriptors, `rename-enemies.mjs`, `convert-to-webp.mjs` |
| `ocr/` | 6 | 1,096 | `ocr-enemy.mjs` (main), `ocr-enemy-name/power.mjs`, `convert-text-to-latin.mjs` |
| `battle/` | 5 | 917 | `run-battle.mjs` |
| root | 4 | 1,476 | `generate-wiki-matrix.mjs`, `generate-wiki-table.mjs`, `file-map-enemies.mjs` |
| `ocr/tests/` | 3 | 216 | collected by vitest |

Unit tests outside `scripts/` live in `tests/unit/` (battle sim, power parsing, WebP conversion).

Current test status: **6 files / 41 tests pass**. `vitest.config.ts` collects `tests/unit/**` and `scripts/ocr/tests/**`; the uncollected `scripts/llm/test/` folder was removed on 2026-11-12 (see P0-5).

---

## 2. P0 — defects that break a documented command or corrupt data

**State (2026-11-12): all six are fixed.** Details are kept as the regression record; each item now carries the change that closed it.

### P0-1 `pnpm ocr:enemy` cannot load: broken relative import
**Status: fixed** — specifier changed to `./enemy-filename-tokens.mjs`; the import scan now reports zero broken imports in shipped code.
`scripts/ocr/ocr-enemy.mjs:23`

```js
import { parseLatinNameHintFromEncodedOriginalBasename } from "../enemy-filename-tokens.mjs";
```

The module lives at `scripts/ocr/enemy-filename-tokens.mjs`; `scripts/enemy-filename-tokens.mjs` does not exist. A mechanical scan of all 34 files found this as the only missing import in shipped code. `rename-enemies.mjs:30` spawns exactly this script, so the whole OCR → rename chain is dead at load time, not just on bad input.

**Fix (applied):** `"./enemy-filename-tokens.mjs"`.

### P0-2 `ReferenceError` swallowed in the enemy CLI
**Status: fixed** — uses `resolved`; `log.txt` is appended again and no spurious warning is printed.
`scripts/llm/llm-enemy-extract.mjs:758-759`

```js
const folder = path.dirname(usedPath);   // usedPath is never declared
const base = path.basename(usedPath);
```

`usedPath` does not exist anywhere in the file. The throw happens *after* `data.json` was written (line 753) but *before* the per-folder `log.txt` append, and is caught by the broad `catch` at line 770, which prints `[Data] failed to write data.json, rename, or cleanup:` — a misleading message, since the write succeeded. Net effect: `log.txt` is never updated by this CLI, and every successful run emits a spurious warning.

**Fix (applied):** use `resolved` (the variable actually in scope).

### P0-3 `rename-enemies.mjs` throws on every file that needs renaming
**Status: fixed** — strict string comparison replaces the non-existent `String.prototype.equals`.
`scripts/llm/rename-enemies.mjs:318`

```js
const newName = latinNameToken?.equals(englishNameToken)
```

Both operands are strings; `String.prototype.equals` does not exist, and the optional chain only guards `latinNameToken` itself. Reached for any image without a stored canonical key, so it throws `latinNameToken.equals is not a function`. This makes the fallback naming path (the one used after OCR) unusable even if P0-1 is fixed.

**Fix (applied):** `latinNameToken === englishNameToken`.

### P0-4 Documented zoom slider in the duel gallery is never emitted
**Status: fixed** — `slider: true` default added; `--slider`/`--zoom` and `--no-slider`/`--no-zoom` are parsed. Verified by generating a gallery from two real duel images: `zoom-toolbar` and `zoom-slider` each appear once.
`scripts/generate-wiki-matrix.mjs:718,746`

The header documents `slider: true` ("zoom slider toolbar at the top") and `--no-slider` (lines 11, 20), but `parseArgs` (lines 142-295) never defines `slider`, so `args.slider` is always `undefined` and both the toolbar markup and the scaling `<script>` are skipped. The generated `index.html` silently loses the feature that `--width/--height/--scale` is designed to drive.

**Fix (applied):** added `slider: true` to the defaults and parsing for `--slider` / `--no-slider`.

### P0-5 Three test files are non-runnable and one fixture is gone
- `scripts/llm/test/llm-google_gemma-4-26b-a4b.ts:23-24` imports `../../scripts/llm/...` (one level too deep) and `../../scripts/ocr/...`.
- `scripts/llm/test/run-llm-convert-test.mjs:4-5` imports `./enemy-image-webp.mjs` and `../ocr/...`; from `scripts/llm/test/` the correct paths are `../enemy-image-webp.mjs` and `../../ocr/...`.
- `scripts/llm/test/llm-convert.test.ts:10` depends on `data/enemies/test/Screenshot_2026.06.19_09.49.47.958.png`, which no longer exists (`fs.access` at line 13 would reject).
- `vitest.config.ts` does not include `scripts/llm/test/**`, which is why CI is green despite all of the above. Two of the three files are also near-identical copies of each other.

**Status: fixed** — the two duplicate/one-off files were deleted and `scripts/llm/test/` removed. The conversion test was re-added as `tests/unit/webp-conversion.test.ts`, which builds its own PNG fixture with sharp (no committed screenshot), disables `sharp.cache`, and retries temp-dir cleanup for Windows `EBUSY`. Suite is now 5 files / 21 tests, all collected.

### P0-6 `update-package-script.mjs` writes a corrupt `package.json`
`scripts/update-package-script.mjs:5-6`

```js
j.scripts['llm:convert:test:google/gemma-4-26b-a4-26b-a4-26b-a4b'] = '...'
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\\n', 'utf8');
```

`'\\n'` is a literal backslash + `n`, so the file would end with `}\n` as text, not a newline; the injected script name is a nonsense model id. It is a one-off scratch script from Aug 4 that must never be run again.

**Status: fixed** — file deleted; nothing referenced it.

---

## 3. P1 — structural duplication (the dominant maintenance cost)

### P1-1 Three conversion entry points, ~90 % identical — **resolved**
| File | LOC | Extraction used | Retries | Writes `data.json` | Unique behavior |
|---|---:|---|---|---|---|
| `llm/convert.js` | 341 | full screenshot | yes (3×, backoff) | no (only via `saveFileMap`) | none |
| `llm/convert2.js` | 371 | name/power crops | yes | yes | default target of `clan-clash.mjs` |
| `llm/convert-with-llm.js` | 142 | full screenshot | **no** | no | warns when `power < 444` (line 78) |

`convert.js` and `convert2.js` share the imported module set, `parseArgs`, `delay`, `summarizeDurations`, `formatDuration`, `resolveExistingOutput`, `mapEntryFromRow`, and the entire per-file skip/map/convert loop. `clan-clash.mjs:147-158` already treats them as one script selected by `--script`.

**Status: fixed 2026-11-12** — all three replaced by `llm/convert.mjs` (854 → 492 lines):

- `--mode crops` (default) → `extractEnemyDataFromNamePowerCrops`; `--mode screenshot` (aliases `full`, `-M`) → `extractEnemyDataFromScreenshot`.
- The `convert-with-llm.js` low-power diagnostic is now `LOW_POWER_WARN_THRESHOLD = 444` and fires in both modes (`convert.mjs:213`), with no CLI flag.
- `clan-clash.mjs` keeps its interface: `--script convert` → screenshot, `--script convert2` → crops (default), both now executed as `convert.mjs --mode …`.
- The folder argument is required; the stale `data/enemies/2026-05-22/test` and `data/clan_clash/2026-09-18` defaults are gone.
- The pre-conversion `data.json` record (language, `processingMs`, `canonical`, `extractedAt`) now runs in both modes, and a failed write warns instead of being swallowed.

### P1-2 Two LLM extractors, ~85 % identical — **resolved**
`llm-enemy-extract.mjs` and `llm-formation-extract.mjs` duplicated: config loading, `normalizeCropConfig`, crop-config resolution, `resolveVisionModel`, `fetchWithTimeout`, `chatVisionWithImages`, `extractTextFromLmStudioResponse`, `parseJsonFromLlm`, the normalizers, `crop*RoiToPngBuffer`, `upsert*DataJsonForImage`, the reconciliation routine, and the CLI shell. The only real differences are the `enemy` vs `clan` config subtree, default ROI, default model, and "name missing → `UNKNOWN`" vs "name missing → throw".

**Status: fixed 2026-11-12** — shared plumbing moved to `llm/vision-client.mjs` (680 lines); the extractors are now 200 / 182 lines of prompts, ROIs and normalisers passed to `createVisionTarget()`. Total 1,457 → 1,062 lines. `vision-client.mjs` owns config/model resolution, HTTP + timeout, JSON parsing, power validation, ROI crops, `upsertDataJsonForImage`, `reconcileDataJsonWithCanonicalFiles` and the single-image CLI shell (`runVisionExtractCli`). All previous named exports are preserved, so `convert.mjs`, `run-llm-real-test.mjs` and the formation CLI keep working; descriptor differences (default model fallback, hint list, `UNKNOWN` name, and the clan full-screenshot prompt fallback) are explicit in the descriptors.

### P1-3 Dead code inside the extractors — **resolved**
The four unreferenced functions were removed during the P1-2 rewrite:

- `llm-enemy-extract.mjs:281` `renameEnemyImageToCanonicalLike`
- `llm-enemy-extract.mjs:308` `removeEnemyOriginalIfCanonicalExists`
- `llm-formation-extract.mjs:481` `removeOriginalIfCanonicalExists`
- `llm-formation-extract.mjs:505` `renameImageToCanonicalLike`

They contradicted the code's own comments at `llm-enemy-extract.mjs:749` / `llm-formation-extract.mjs:656` ("Do not rename originals"), and were the only uses of `canonicalEnemyMapKey`/`WORKSPACE_ROOT` in those files.

---

## 4. P2 — data-flow and configuration inconsistencies

### P2-1 Two sources of truth for the file map — **resolved**
**Status: fixed 2026-11-12** — per-folder `data.json` is the only store:

- `file-map-enemies.mjs` no longer defines `DEFAULT_FILE_MAP_PATH`; `loadExistingFileMap()` rebuilds from `data/clan_clash/**/data.json` only (honouring each entry's `canonical`/`originalFileName`), and `saveFileMap()` writes just the per-folder `data.json`. The legacy read/unlink pair is gone; merges preserve existing `processingMs`/`extractedAt`/`language` instead of clobbering them.
- OCR no longer reads or writes a master map: `loadConfiguredFolders()` discovers `data/clan_clash/YYYY-MM-DD` folders that contain images — the same set the old global map registered, excluding `clan/`, `victory/`, `duel/`, `catapults/`. Results are written into the source folder's own `data.json`, and skip-if-recorded checks that file. `--out` was removed.
- Deleted `sync-filemap-to-clan.mjs` and the embedded clan `data.json` merge in `clan-clash.mjs`; removed `convert-to-webp.mjs --map`.
- Fixed `resolveDiskOriginalFromMapParts`: keys shaped `<folder>/<name>/<canonical>.webp` now resolve to the real folder for webp-keyed entries too; previously clan entries produced file-path "folders" and `saveFileMap` failed silently.
- Verified against the live data: 133 rows rebuild, arena + clan entries resolve to the correct folder/original, 0 rows with file-path folders; an end-to-end OCR run in a throwaway `data/clan_clash/2099-01-01` folder wrote its `data.json`, and a re-run skipped the recorded image.

Historical note: `loadExistingFileMap()` used to prefer `data/clan_clash/fileMap.json` and fall back to `data/clan_clash/**/data.json`, while `saveFileMap()` unlinked the legacy file after every image — so the two stores could never stay in sync.

### P2-2 Timeout defaults disagree with `config/llm.json` — **resolved**
**Status: fixed 2026-11-12** — `convert.mjs` now imports `loadLlmConfig()` and `REQUEST_TIMEOUT_MS` from `vision-client.mjs`, so the per-attempt base defaults to `config.requestTimeoutMs` (60 s) instead of a hardcoded 600 s, and attempt N is documented as `N × base`. The stale "(default 10 min)" comment and the duplicate config read are gone.

Historical values: `config/llm.json` 60 000; `vision-client.mjs` fallback 180 000; `convert.mjs` fallback 600 000 with a stale comment.

### P2-3 Silent persistence failures
`data.json` writes are swallowed with empty catches, so partial runs look successful:

- ~~`convert2.js:312-314`~~ — `convert.mjs` now warns on a failed record write
- ~~`file-map-enemies.mjs:296-298` (`saveFileMap`)~~ — now warns (P2-1)
- ~~`clan-clash.mjs:342-344` (fileMap → clan `data.json` merge)~~ — merge removed (P2-1)

Remaining gap: none — `reconcileDataJsonWithCanonicalFiles` now moves stale originals to `_orphaned/` and warns on failure (see P2-4).

### P2-4 Destructive reconciliation contradicts stated policy — **resolved**
**Status: fixed 2026-11-12** — `reconcileDataJsonWithCanonicalFiles` (`vision-client.mjs`) no longer deletes anything: a stale original that still exists is moved to `<folder>/_orphaned/<name>` (creating the folder on demand) and logged; `ENOENT` is ignored, other failures warn. The data.json re-keying behaviour is unchanged.

### P2-5 Battle report can misreport its own config source — **resolved**
**Status: fixed 2026-11-12** — `combat-engine.mjs` exports `DEFENSE_FACTOR` and `TICK_DT_SEC`, and `run-battle.mjs` reports them along with `configSource: config.configDir`, so `--config-dir` is reflected and the constants cannot drift.

### P2-6 Full-screenshot clan extraction has an incoherent fallback
`llm-formation-extract.mjs:133` (`fullPromptFallback: DEFAULT_NAME_CROP.prompt`) uses a *cropped name window* prompt for the *full screenshot* call when config supplies no image prompt. The enemy descriptor correctly falls back to the full-image prompt (`llm-enemy-extract.mjs:147`).

---

## 5. P3 — performance / robustness

### P3-1 OCR name pass is ~1/3 redundant — **resolved**
**Status: fixed 2026-11-12** — the second `setParameters` + three `nameTextResCyr*` recognitions were deleted from `ocr-enemy-name.mjs` (they re-ran the same buffers on the same worker with identical parameters), along with their duplicate entries in both candidate lists. 21 → 18 recognitions per image. A/B run on a real screenshot produced the identical extraction (`power 8104472`, `name "AY AY ОЙ"`).

Historical detail: `nameTextResCyr*` was a verbatim repeat of `nameTextRes*`, and the candidate list at lines 327-349 overlapped the text-area list at 356-372 (which already `Set`-deduplicates).

### P3-2 Heuristic scorers are untested and un-exported — **resolved**
**Status: fixed 2026-11-12** — `cleanupName`, `cleanupNamePhrase`, `scoreNameCandidate`, `isLikelyOcrNoise` and `extractBestPhraseFromRawText` are exported, and `scripts/ocr/tests/unit/ocr-name-heuristics.test.ts` adds 20 tests covering token selection, tag/separator normalisation, scoring weights (length, mixed case, `\`/`|`/brackets, mixed scripts), HUD penalties, phrase extraction and noise detection. Two initial assertions were corrected to match actual behaviour (title-case beats lowercase; phrase cleanup substitutes spaces rather than deleting).

### P3-3 `generate-wiki-table.mjs` does not escape filenames — **resolved**
**Status: fixed 2026-11-12** — added the same `escapeHtml` used by the matrix generator and applied it to the anchor text, `alt` and `<sub>` label (the `id` was already sanitised to `[a-z0-9-]`). Verified with an `A&B.webp` fixture: output contains `A&amp;B` three times and no raw `A&B</b>`.

### P3-4 Windows-only bits are not isolated — **resolved**
**Status: fixed 2026-11-12**
- `llm:clan_clash:clear-lm-cache` now runs `node scripts/llm/clear-lm-prediction-cache.mjs` (CLI entry added), so cache paths resolve from `config/llm.json` on any platform instead of relying on cmd `%USERPROFILE%` expansion. `rimraf` is now unused but kept in devDependencies because the lockfile cannot be regenerated offline (a frozen install would otherwise fail).
- The `EBUSY`/`EPERM` retry now lives inside `writeWebpFromRasterFile` (`enemy-image-webp.mjs`) and rebuilds the Sharp pipeline per attempt, so `convert.mjs`, `rename-enemies.mjs` and `convert-to-webp.mjs` all benefit.
- `.ocr-debug/` added to `.gitignore`.

### P3-5 Strong points worth keeping
- Retry with linear backoff and per-attempt timeouts (`convert.mjs`); `AbortController` timeouts with actionable messages (`vision-client.mjs`).
- Up-front response normalisation/validation (`normalizeEnemyExtraction`, `normalizePower...`) — the previous revision claimed this was missing; it exists.
- Tesseract workers are created once and terminated in `finally` on all three CLIs — no leak (previous revision claimed one).
- `convert-to-webp.mjs` supports `--dry-run`; `generate-wiki-matrix.mjs` percent-encodes remote URLs; filenames are percent-escaped for Windows.

---

## 6. P4 — tests, scripts, docs

### P4-1 Coverage gaps (highest value first)
1. `normalizeEnemyExtraction` / `parseEnemyJsonFromLlm` / `normalizeClanExtraction` — pure functions, no I/O, zero tests.
2. `canonicalEnemyMapKey` / `collectEnemyEntriesFromMap` / `findEnemyRowBySourceRel` — the path algebra behind every output filename, untested.
3. `combat-engine` outcome ordering (`decideOutcome`) — only `computeDamage` and `estimateClashScore` are tested (`tests/unit/battle-sim.test.ts`).
4. ~~OCR cleanup/scoring heuristics~~ — covered by `scripts/ocr/tests/unit/ocr-name-heuristics.test.ts` (20 tests).
5. `generate-wiki-matrix.splitVsParts` (separator rules) and `parseArgs` — no test, and P0-4 shows why pass-through flags need one.

### P4-2 `package.json` drift — **resolved**
**Status: fixed 2026-11-12**
- `name` → `kingdom-clash-duel`.
- Removed the duplicate `ocr:enemies`; `ocr:enemies:process` now chains `ocr:enemy` + `llm:convert:webp`, and the webp script was renamed from `llm:clan_clash:webp` to the name the README already used.
- `llm:clan_clash` no longer hardcodes `2026-11-06` (uses the latest date folder); `generate-wiki-table:duels` pointed at a non-existent `2026-11-06/duels` and now targets `2026-10-30/duels`.
- Added `ocr:rename-enemies` (the script existed but was unreachable from the documented interface).
- README no longer advertises the removed `--out` flag, the missing `llm:convert` script or the `data/enemies` example path.
- Remaining by design: the six `extract:image:*` one-offs (working crop commands with different coordinates) and the three `llm:clan_clash:test:*` scripts (their `data/clan_clash/test/<model>` folders exist).

### P4-3 Doc/comment drift — **resolved**
**Status: fixed 2026-11-12**
- `parseRecursiveLevel()` now defaults to 0, matching the documented "default 0 = root only"; bare `--recursive` still means 1 and the header says so. Verified via the CLI: `--recursive=` → `recursive=0`, `--recursive` → `recursive=1`.
- `rename-enemies.mjs` dropped its private `formatPower` and uses `formatPowerForFilename` from `file-map-enemies.mjs`.
- `WORKSPACE_ROOT` is now defined once (`file-map-enemies.mjs`); `battle/load-apk-config.mjs`, `generate-wiki-table.mjs` and `generate-wiki-matrix.mjs` import it.
- The stale `convert.js`/`convert2.js` names in the `clan-clash.mjs` header were removed.

Fixed earlier: `README.md` store description (P2-1); `convert-with-llm.js` header claim (file deleted, P1-1).

---

## 7. Recommended sequence

| # | Task | Files | Why first |
|---:|---|---|---|
| 1 | Fix P0-1, P0-2, P0-3, P0-4 (4 one-line-ish fixes) | `ocr/ocr-enemy.mjs`, `llm-enemy-extract.mjs`, `llm/rename-enemies.mjs`, `generate-wiki-matrix.mjs` | Restores two documented pipelines and the gallery feature — **done** |
| 2 | Delete `update-package-script.mjs` and the 3 uncollected test files; re-add the conversion test in `tests/unit/` | root, `llm/test/`, `tests/unit/` | Stops rot from spreading — **done** |
| 3 | Merge `convert.js` + `convert2.js` into `convert.mjs --mode`; delete `convert-with-llm.js` after porting the `<444` warning | `llm/` | Removes ~600 duplicated lines, one third of `llm/` — **done** (854 → 492 lines) |
| 4 | Extract `llm/vision-client.mjs`; collapse both extractors to descriptors; delete the 4 dead functions | `llm/` | Second-largest duplication — **done** (1,457 → 1,062 lines) |
| 5 | Make per-folder `data.json` the only store; remove `DEFAULT_FILE_MAP_PATH` read/unlink and hardcoded default folders | `file-map-enemies.mjs`, `llm/*`, `clan-clash.mjs` | Removes a whole class of "why did it re-run the LLM" bugs — **done** |
| 6 | De-duplicate the OCR recognition pass; export the scorers; add P4-1 tests | `ocr/`, `tests/unit/` | Direct latency win + regression net for heuristics — **done** (21 → 18 recognitions, +20 tests) |
| 7 | Reconcile timeouts in `config/llm.json` vs code, fix battle-report config fields, escape wiki-table names, add `.ocr-debug/` to `.gitignore` | misc | Small, independent — **done** (plus the Windows cache-clear script and package/README drift) |

## 8. How to verify after changes

```bash
pnpm test:unit                       # must stay green (currently 41/41)
node --check scripts/ocr/ocr-enemy.mjs 2>/dev/null || true   # ESM: use import
node -e "import('./scripts/ocr/ocr-enemy.mjs')"             # P0-1: no ERR_MODULE_NOT_FOUND
node scripts/generate-wiki-matrix.mjs data/clan_clash/2026-10-30/duels jpg png webp --compact --height 600
grep -c "zoom-toolbar" data/clan_clash/2026-10-30/duels/index.html   # P0-4: must be 1
```

A mechanical import check (all relative `from`/`import()` specifiers resolve to an existing file) is the cheapest guard against P0-1/P0-5 recurring; it is 15 lines of Node and belongs in `pnpm ci`.

---

## 9. Corrections to the previous revision of this document

| Previous claim | Actual |
|---|---|
| "6 test files in `scripts/llm/test/` and `scripts/ocr/tests/unit/`" | 3 files in `llm/test` (all non-runnable or uncollected) + 2 in `ocr/tests/unit` (collected) |
| "convert-with-llm.js is a main orchestrator" | Not referenced by `package.json` or any script; `clan-clash.mjs` orchestrates (file deleted in the P1-1 merge) |
| "No validation of LLM response quality" | `normalizeEnemyExtraction` / `normalizeClanExtraction` validate name/power and throw; retries exist |
| "Memory leaks in OCR scripts (workers only cleaned in `finally`)" | Workers *are* created once and terminated in `finally`; there is no leak |
| "No explicit ReturnType annotations / missing type safety" | Codebase is JSDoc-typed JS; `tsconfig` type-checks `*.ts` only — the gap is tests, not annotations |
| "`show-llm-config.mjs` silently fails on missing `.env.local`" | It deliberately returns `{}` and prints config/env provenance; the fallback is intentional |
| "Duplicate conversion scripts: 85 % identical" | Closer to 90-95 %; `convert2.js` also persists `data.json` and is the default |
| Missing entirely | P0-1 (broken import), P0-2 (`usedPath`), P0-3 (`.equals`), P0-4 (`args.slider`), P2-1 (map store split), P2-4 (destructive reconcile) |
