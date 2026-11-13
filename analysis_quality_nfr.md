# Code Quality / Performance / NFR Analysis

**Date:** 2026-11-13 · **Scope:** `scripts/**` (39 source files, 7,527 lines) plus `tests/**` (28 files, 192 tests)
**Method:** static scans (patterns, sizes, call sites), targeted code reading, and measurements on the live data set (`loadEnemyMap`, row collection, OCR runs, map-save call graph).

---

## 1. Measured baseline

| Metric | Value | Notes |
|---|---:|---|
| Source files / lines | 39 / 7,527 | `scripts/**`, excl. tests/fixtures |
| Test files / tests | 28 / 192 | `pnpm test:unit`, all green |
| `console.*` calls | 170 | no log levels, no timestamps (except `clan-clash` tee) |
| `process.exit()` calls | 45 | all inside CLI paths (acceptable, see §2.6) |
| `main()` guards | 14 files | duplicated 10-line pattern |
| `loadEnemyMap()` | 43 ms | 133 rows across 2 `data.json` files |
| `collectEnemyEntriesFromMap()` | 1.3 ms | per call; called per converted file |
| OCR recognitions / image | 19 (arena), 24 (clan) | measured wall time 5.9–7 s per image |
| LLM worst case / image | 3 × 60 s + backoff | `config/llm.json` `llmMaxAttempts`/`llmTimeoutPerAttemptMs` |

The dominant costs are tesseract recognitions (OCR) and LM Studio inference (LLM); map/data.json work is milliseconds at the current data scale but scales poorly (see §3.4).

---

## 2. Antipatterns (prioritized)

### 2.1 Non-atomic `data.json` writes — **data-integrity risk (HIGH)**
Five writers truncate-then-write, so a crash/power loss mid-write corrupts a folder's only record store:
- `pipeline/data-json-store.mjs:37` `writeFolderEntries`
- `enemy-records.mjs:261` `saveEnemyMap`
- `llm/vision-client.mjs:452` `upsertDataJsonForImage`
- `llm/vision-client.mjs:520` `reconcileDataJsonWithCanonicalFiles`

**Fix:** one helper `writeJsonAtomic(path, value)` (`writeFile` to `path.tmp-<pid>` then `rename`) used by all four. Low risk, high value; `.tmp` leftover is harmless and can be ignored.

### 2.2 Dataset-specific correction inside the library (MEDIUM)
`ocr/ocr-enemy-name.mjs:269-273` hardcodes `AulN|/SulN|/HulN| → HuN|`. It is measured and tested, but it encodes one clan's tag in generic code.
**Fix:** move the table to `config/llm.json` (e.g. `ocr.clanNameCorrections: { "AulN|": "HuN|", … }`) and keep the function table-driven with a built-in default.

### 2.3 Magic numbers spread across strategies (MEDIUM)
Thresholds and sizes are inline and undocumented in one place: `warnBelowPower = 444` (`llm-strategy.mjs:113`), picker cut-offs `>= 20` / `>= 80` / `letters >= 4` (`ocr-enemy-name.mjs:303-306`), OCR upscale widths 1800/2000/2200/2400 (`:336-361`), tight-box growth `[0.03,0.05]` (`ocr-enemy-crops.mjs:76`), splash factor `0.35` (`combat-engine.mjs:144`), outcome multiplier `0.35` (`clash-score.mjs:23`).
**Fix:** a `scripts/constants.mjs` (or `config/llm.json` for tunables) with named constants; no behaviour change.

### 2.4 Duplicated CLI bootstrap (LOW, mechanical)
`invokedDirectly` + `main().catch(...)` is repeated in 14 files (28 occurrences). One helper (`scripts/cli.mjs: isMain(import.meta.url)`) removes ~80 lines and guarantees consistent exit handling.

### 2.5 Integer-by-inference in data loading (MEDIUM)
`loadEnemyMap` trusts every `data.json` field (`Number(entry?.power) || 0`, arbitrary `canonical` strings). A hand-edited or half-written file silently produces placeholder rows; `saveEnemyMap` will then propagate them.
**Fix:** validate entries on load (skip + warn once per folder) or add a `--strict-data` flag; never persist `power: 0` rows.

### 2.6 `process.exit` inside parsers (LOW)
`extract_image.mjs` `parseArgs`/`parseNonNegInt` and `run-battle.mjs` `parseArgs` exit the process directly, which forces tests to mock `process.exit`. CLI-only today, but it blocks reuse.
**Fix:** throw a typed usage error in parsers; the CLI catches it, prints usage, exits 1.

### 2.7 Silent-by-comment catches (LOW-MEDIUM)
Several catches swallow errors with only a comment (`data-json-store.mjs` read, `enemy-records.mjs` walk/stat paths, `loadConfiguredFolders`). They are intentional fallbacks but invisible.
**Fix:** `DEBUG=1` diagnostic path or a single `warnOnce()` helper.

### 2.8 Layout tables & generated HTML metadata (LOW, accessibility)
Generated `index.html` files start with `<table>` only — no `<html lang>`, `<meta charset>`, viewport; matrix uses tables for layout and empty cells without headers. GitHub's renderer mitigates, but the files are not self-describing documents.
**Fix:** wrap output in a minimal `<html lang="en"><head><meta charset="utf-8">…` document (does not affect GitHub table rendering) and add `scope="col"`/`scope="row"` on matrix headers.

### 2.9 Large single-function OCR pipeline (LOW, maintainability)
`ocrEnemyName` spans ~200 lines (`ocr-enemy-name.mjs:326-560`) with 20+ local buffers and a hand-rolled candidate list. It works and is heuristic by nature, but the preprocessing matrix is implicit.
**Fix (with §3.2):** drive recognitions from a small declarative table `{crop, preprocess, psm, whitelist}`; easier to trim and measure.

---

## 3. Speed: profile and opportunities

### 3.1 Tesseract is the bottleneck (OCR paths)
24 recognitions per clan image (19 arena) dominate the 6–7 s wall time. Ranked options, each measurable with `pnpm eval:clan-ocr`:

1. **Trim redundant variants (est. −20–30%).** Neutral/raw/threshold are run on name, wide, text and line crops; several are near-duplicates (measured outputs identical on the fixture). Drop variants one at a time and keep the one the eval shows is load-bearing.
2. **Skip `prepare()` when there are no files (est. −1–2 s for empty/CI runs).** `run-extraction.mjs:114` creates two workers before discovering zero targets.
3. **Parallelise name and power (est. −15–25% on multi-core, +1 worker memory).** Power OCR is one recognition; run it on a third worker concurrently with name OCR. Tesseract workers are not concurrency-safe individually.
4. **Early exit (est. −10–20%).** If the first candidate group already matches a strong pattern (tag separator + confidence above threshold), skip the remaining groups.

### 3.2 LLM path
- Retries cost up to ~3 min + backoff per image on a wedged LM Studio (`llm-strategy.mjs`): make the escalation explicit in logs (already logged per attempt) and consider a cheaper total budget (`llmMaxTotalMs`).
- `clearPredictionCacheBeforeEachCall: true` in config deletes cache directories per call; this is a correctness choice, not a bug, but it is measurable I/O. A/B one folder with it off before changing defaults.

### 3.3 Duplicate `data.json` reads
`convert` runs with `cacheEntries: false` (`llm/convert.mjs`) to preserve `saveEnemyMap` merge semantics; that re-reads `data.json` per file. At current sizes (133 rows) this is sub-millisecond; it matters only at thousands of rows. Documented tradeoff, no action.

### 3.4 Map scaling behaviour
`saveEnemyMap()` (`enemy-records.mjs:261`) re-collects and rewrites **every** folder's `data.json` on each call, and the runner calls it once per converted file (`run-extraction.mjs:209,222`). Cost today: 1.3 ms + 2 file writes per image. At 100 folders × 1,000 rows it becomes O(files × folders × rows).
**Fix:** collect the rows once per run and save per-folder once (runner already writes the extracted record per file, so per-file map saves are redundant except for the map-only path).

### 3.5 Lookup hot path
`findEnemyRowBySourceRel` (`enemy-records.mjs:316`) linearly scans all rows for every file. Build a `Map<sourceRel, row>` once per run (injectable index) and reuse it in `resolveExistingOutput`.

---

## 4. Non-functional requirements assessment

| NFR | Current state | Risk | Recommendation |
|---|---|---|---|
| **Data integrity** | per-folder `data.json` is the sole store; writes non-atomic; no schema validation | **High** | atomic write helper; validate on load; keep `_orphaned` move (already non-destructive) |
| **Reliability** | LLM retries + timeouts; OCR has no retry or watchdog; tesseract language data fetched from CDN on cold cache | **Medium-High** | add per-image watchdog/timeout; bundle or pre-cache `eng/rus.traineddata` (`langPath`) so OCR works offline |
| **Performance** | OCR/LMM dominate; map writes scale poorly | Medium | §3.1–3.4 |
| **Observability** | 170 `console.*`; durations summarized; per-folder `log.txt` only via `clan-clash`; eval harness reports accuracy | Medium | tiny logger with levels + `--verbose`; add timing lines per phase |
| **Security** | no shell interpolation of filenames (spawn arg arrays), URL encoding, path-containment checks for generators, token never printed, env expansion only from trusted config | Low | keep; add a note that `config/llm.json` is trusted input |
| **Portability** | Node 22 engines, dual-OS CI, path normalization via `toMapKey`, Windows EBUSY retry | Low | tesseract network dependency is the remaining platform risk |
| **Maintainability** | JSDoc types, 192 tests, strategy/runner seams; but 572-line OCR module, 861-line matrix generator, duplicated guards, magic numbers | Medium | §2.3, §2.4, §2.9 |
| **Testability** | DI strategies, guarded CLIs, synthetic APK fixtures, labelled OCR harness; no coverage measurement | Low-Medium | add `@vitest/coverage-v8` and a coverage threshold |
| **Accessibility (generated HTML)** | layout tables, no document head/lang | Low | §2.8 |
| **Determinism** | seeded battle sim, `temperature: 0` for LLM; tesseract output can drift with version | Low | pin/track tesseract version in docs |
| **Scalability** | map rebuild scans all folders at startup (43 ms now); per-file map saves | Medium | §3.4/3.5 |

---

## 5. Proposed order of work

| # | Change | Area | Expected effect | Risk |
|---|---|---|---|---|
| 1 | `writeJsonAtomic()` used by all `data.json` writers | integrity | eliminates partial-file corruption | low |
| 2 | Validate `data.json` entries on load (warn+skip) | integrity | no placeholder rows propagated | low |
| 3 | Skip `prepare()` when a run has no files | speed | −1–2 s on empty/CI runs | trivial |
| 4 | Batch `saveEnemyMap` per folder; build source→row index once | speed/scaling | fewer writes, O(1) lookups | low |
| 5 | OCR variant trim + optional 3rd worker, validated by `pnpm eval:clan-ocr` | speed | −20–40% OCR wall time | medium |
| 6 | Shared `isMain()` helper; constants module | quality | −80 lines, named tunables | low |
| 7 | Config-driven clan-name corrections; move `444`/picker cut-offs to config | quality | removes dataset-specific code from library | low |
| 8 | Typed usage errors instead of `process.exit` in parsers | quality | reusable parsers, simpler tests | low |
| 9 | Logger with levels + `--verbose`; per-phase timings | observability | diagnosable performance | low |
| 10 | Coverage tooling + threshold; minimal HTML document wrapper | quality/accessibility | measurable coverage, self-describing output | low |

**Verification for each step:** `pnpm test:unit`, `pnpm check:imports`, `pnpm eval:clan-ocr` (for OCR changes), `pnpm install --frozen-lockfile --lockfile-only`, and `git status -- data` clean after temp-folder smokes.

---

## 6. What is already good (keep)

- Explicit strategy/runner seam with dependency injection and fake-based tests.
- Single record store with a non-destructive reconcile (`_orphaned/`).
- Retry/backoff and timeouts in the LLM client; EBUSY/EPERM retry for WebP writes.
- Percent-safe filenames, path-containment checks in generators, no token logging.
- Dual-OS CI, frozen lockfile, import resolution checks, labelled OCR evaluation harness.

---

## 7. Implementation status (2026-11-13)

The first batch from §5 is implemented on `refactor`:

| # | Change | Status | Evidence |
|---|---|---|---|
| 1 | `writeJsonAtomic()` in every `data.json` writer | **done** | `scripts/atomic-json.mjs` used by `data-json-store`, `saveEnemyMap`, both `vision-client` writers; `tests/unit/atomic-json.test.ts` (2) |
| 2 | Validate entries on load | **done** | `isValidStoredEntry` + injectable workspace root in `loadEnemyMap`; warns once per folder; `tests/unit/enemy-records.test.ts` (+2) |
| 3 | Skip `prepare()` on empty runs | **done** | `run-extraction.mjs` early return; `ocr-enemy`/`ocr-clan --limit 0` now ~0.22 s (was worker init) |
| 4 | Batched map saves + source index | **done** | one `saveEnemyMap` per run (`mapDirty`), `buildEnemySourceIndex` for lookups; runner tests +1 |
| 5 | Shared `isMain()` + constants | **done** | `scripts/cli.mjs` used by 15 CLIs (no `invokedDirectly` left); `scripts/constants.mjs` for 444/picker/widths/growth/battle factors |

Post-batch measurements: `pnpm test:unit` 29 files / 199 tests; `pnpm check:imports` 68 files; `pnpm eval:clan-ocr` unchanged (92.4% overall, 54.5% OCR-only, 11/12 exact, power 12/12); `convert --extractor ocr` smoke persists `data.json` once per run and leaves no `.tmp` files.

Still open from this analysis: OCR variant trimming + optional third worker (§3.1, needs A/B), typed usage errors (§2.6), logger with levels (§4), coverage tooling and HTML document wrapper (§2.8/§4), and offline tesseract language data (§4 reliability).

