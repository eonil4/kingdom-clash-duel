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
| LLM worst case / image | 60+120+180 s + backoff (~6 min) | escalating `llmTimeoutPerAttemptMs`; now bounded by `llmMaxTotalMs` |

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

### 2.2 Dataset-specific correction inside the library (MEDIUM) — **resolved**
`correctClanNameConfusables(text, corrections)` now iterates a leading-token table instead of a hard-coded regex; the measured entries live in `DEFAULT_CLAN_NAME_CORRECTIONS` (`constants.mjs`) and can be overridden via `ocr.clanNameCorrections` in `config/llm.json` (the strategy validates/trims entries and falls back to the default when the section is absent or invalid). Behaviour and the labelled eval are unchanged.

### 2.3 Magic numbers spread across strategies (MEDIUM)
Thresholds and sizes are inline and undocumented in one place: `warnBelowPower = 444` (`llm-strategy.mjs:113`), picker cut-offs `>= 20` / `>= 80` / `letters >= 4` (`ocr-enemy-name.mjs:303-306`), OCR upscale widths 1800/2000/2200/2400 (`:336-361`), tight-box growth `[0.03,0.05]` (`ocr-enemy-crops.mjs:76`), splash factor `0.35` (`combat-engine.mjs:144`), outcome multiplier `0.35` (`clash-score.mjs:23`).
**Fix:** a `scripts/constants.mjs` (or `config/llm.json` for tunables) with named constants; no behaviour change.

### 2.4 Duplicated CLI bootstrap (LOW, mechanical)
`invokedDirectly` + `main().catch(...)` is repeated in 14 files (28 occurrences). One helper (`scripts/cli.mjs: isMain(import.meta.url)`) removes ~80 lines and guarantees consistent exit handling.

### 2.5 Integer-by-inference in data loading (MEDIUM)
`loadEnemyMap` trusts every `data.json` field (`Number(entry?.power) || 0`, arbitrary `canonical` strings). A hand-edited or half-written file silently produces placeholder rows; `saveEnemyMap` will then propagate them.
**Fix:** validate entries on load (skip + warn once per folder) or add a `--strict-data` flag; never persist `power: 0` rows.

### 2.6 `process.exit` inside parsers (LOW) — **resolved**
`extract_image.mjs` and `run-battle.mjs` parsers now throw `UsageError` (`scripts/cli.mjs`); the CLI entry points print the message + usage and exit 1, and tests assert the errors instead of mocking `process.exit`.

### 2.7 Silent-by-comment catches (LOW-MEDIUM) — **resolved**
`logOnce(level, key, …)` (`log.mjs`) dedupes a diagnostic per key and level. Unreadable/unparseable `data.json` now warns once per folder in both the store read and the map merge (missing files stay silent), and a discovered folder that cannot be read logs once at `debug`. `loadEnemyMap`'s parse fallback and `loadConfiguredFolders`' readdir fallback are covered; only genuinely expected fallbacks (ENOENT on a new folder, logical-only map segments) remain silent.

### 2.8 Layout tables & generated HTML metadata (LOW, accessibility) — **resolved**
Both generators now emit a full document via `scripts/html-document.mjs` (`<!DOCTYPE html>`, `<html lang="en">`, charset, viewport, escaped `<title>`), and matrix headers carry `scope="col"`/`scope="row"`. GitHub's table rendering is unchanged.

### 2.9 Large single-function OCR pipeline (LOW, maintainability) — **resolved**
`ocrEnemyName` now drives recognitions from `NAME_RECOGNITION_GROUPS` — 4 groups / 16 variants of `{ crop, width, threshold?, worker, psm, whitelist }`, with a per-crop/threshold buffer cache and one group runner. The arena early exit reads the first group's results, and the Latin-only repair group is gated with `onlyWhen: "tight"`. Candidate scoring is unchanged; behaviour verified byte-identical on 10 real arena screenshots and unchanged on the labelled clan eval.

---

## 3. Speed: profile and opportunities

### 3.1 Tesseract is the bottleneck (OCR paths)
24 recognitions per clan image (19 arena) dominate the 6–7 s wall time. Ranked options, each measurable with `pnpm eval:clan-ocr`:

1. **Trim redundant variants (est. −20–30%).** Neutral/raw/threshold are run on name, wide, text and line crops; several are near-duplicates (measured outputs identical on the fixture). Drop variants one at a time and keep the one the eval shows is load-bearing.
2. **Skip `prepare()` when there are no files (est. −1–2 s for empty/CI runs).** `run-extraction.mjs:114` creates two workers before discovering zero targets.
3. **Parallelise name and power — done, measured −4–5% (+1 worker).** `ocrEnemyPower` now runs on its own digits-only `eng` worker concurrently with the name pass (`Promise.all`), since a tesseract worker is not concurrency-safe. Instrumented eval (6 clan images): power **76–80 ms/image**, name **1.65–1.7 s/image**, and per-image wall time equals the name pass (serial sum ≈ name + power), so the power pass is fully off the critical path. The gain is ~80 ms/image rather than the estimated 15–25% because the 17-recognition name pass dominates; it also costs one extra worker's memory.
4. **Early exit — done, measured −12% on the triggering sample.** When the first pass (name/wide crops, PSM 8) already returns a tag-shaped phrase (`\`, `|` or a bracket) with confidence ≥ 60 and no HUD digit islands, the 12 text-area variants and the full-image fallback are skipped and the normalized phrase itself is kept (`isStrongFirstPassResult` + `stripEdgeTagSeparators`). Arena only: clan (`tight`) keeps the full sequence because the Latin repair pass runs in the text area. A/B on 30 real screenshots: 3 records changed (two garbage reads fixed to the canonical name, one cleaned) and 0 regressions; early-exiting images drop from ~3.4 s to 0.86 s. A 10-image arena sample went 34.3 s → 30.2 s (−12%); trigger rate is low (3/30) by design.

### 3.2 LLM path
- Retries cost up to 60+120+180 s + backoff (~6 min) per image on a wedged LM Studio (`llm-strategy.mjs`) — **done, bounded**. `createLlmStrategy({ maxTotalMs })` reads `llmMaxTotalMs` from `config/llm.json` (120 s there; 0/absent disables): each next attempt is only started while budget remains, its timeout is clamped to the remaining time, the backoff is clamped too, and exhaustion throws `LLM total time budget of 2.0m exhausted after N attempt(s)` with the last error. Attempt logs now include the remaining budget. Tests inject a clock and cover clamping, exhaustion and delay clamping.
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
| **Testability** | DI strategies, guarded CLIs, synthetic APK fixtures, labelled OCR harness; V8 coverage with thresholds in CI (`pnpm test:coverage`) | Low | lowest-covered CLIs now covered at helper level (see §7 #17); their `main()` bodies still rely on integration runs |
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
| 6 | OCR variant trim (§3.1) | **done** | removed the redundant `raw` passes (24 → 17 recognitions): single-image OCR 7.4 s → **4.9 s (−34%)**; eval exact unchanged 11/12, overall similarity 92.4 → 91.7, power 12/12 |
| 7 | Offline tesseract language data (§4 reliability) | **done** | `defaultWorkerOptions()` points tesseract at the bundled `eng/rus.traineddata` (`gzip:false`, temp cache) and falls back to the CDN only when they are missing; eval sample 100%, no download cache created |
| 8 | Typed usage errors in parsers (§2.6) | **done** | `UsageError` in `cli.mjs`; `extract_image`/`run-battle` parsers throw, CLIs print usage + exit 1; tests assert messages |
| 9 | Logger with levels (§4 observability) | **done** | `scripts/log.mjs` (`LOG_LEVEL=silent…debug`, default info); pipeline/strategies/vision-client diagnostics migrated; `debug` adds per-file timings + indexed-source count; `tests/unit/log.test.ts` |
| 10 | Coverage tooling (§4 testability) | **done** | `@vitest/coverage-v8` + `pnpm test:coverage`; V8 coverage over `scripts/**/*.mjs` (manual LM Studio test excluded), thresholds now 93/81/81/93 against the measured 93.8 / 82.5 / 82.7; Linux CI runs the coverage job |
| 11 | Self-describing HTML output (§2.8) | **done** | `scripts/html-document.mjs` wraps both generators (doctype/lang/charset/viewport/title) and shares `escapeHtml`; matrix headers get `scope="col"/"row"`; `tests/unit/html-document.test.ts` |
| 12 | Parallel name/power OCR (§3.1) | **done** | third `eng` worker runs `ocrEnemyPower` concurrently with the name pass; `dispose()` covers all three (also on partial `prepare()` failure); `tests/unit/ocr-strategy.test.ts` asserts the distinct worker, real overlap, and teardown. Measured power 76–80 ms/image vs ~1.7 s name pass → wall time equals the name pass (−~80 ms/image, +1 worker) |
| 13 | Early exit on a strong first pass (§3.1) | **done** | `isStrongFirstPassResult` (tag shape, ≥60 confidence, no HUD islands) keeps the normalized phrase via `stripEdgeTagSeparators` and skips the 12 text-area variants + fallback on arena images; clan keeps the full pass for the Latin repair. A/B 30 real screenshots: 3 names fixed/cleaned, 0 regressions; triggering images 3.4 s → 0.86 s, 10-image sample −12%; `ocr-name-heuristics.test.ts` +4 */
| 14 | LLM total retry budget (§3.2) | **done** | `maxTotalMs` in `createLlmStrategy` (config `llmMaxTotalMs`, 120 s) clamps per-attempt timeouts and backoff to the remaining budget, skips attempts once it is spent and throws a budget error with the last failure; exhausted-run worst case ~6 min → 2 min; `llm-strategy.test.ts` +3 with an injected clock |
| 15 | Config-driven clan-name corrections (§2.2) | **done** | `correctClanNameConfusables(text, corrections)` is table-driven with `DEFAULT_CLAN_NAME_CORRECTIONS`; `ocr.clanNameCorrections` in `config/llm.json` overrides it (strategy trims, drops invalid entries, falls back to the default); eval unchanged; `ocr-name-heuristics.test.ts` +1 and `ocr-strategy.test.ts` +2 |
| 16 | Diagnose previously silent fallbacks (§2.7) | **done** | `logOnce(level, key, …)` dedupes per key/level; unreadable/unparseable `data.json` warns once per folder (store read and map merge), unreadable discovered folders log once at `debug`; `log.test.ts` +1, `data-json-store.test.ts` +1 |
| 17 | Tests for the lowest-covered CLIs (§4) | **done** | exported pure helpers (`cleanupPower`, `isFullScreenshotForOcr`, `discoverClanFolders(workspaceRoot)`, `convert-to-webp.parseArgs`, rename-enemies `parseArgs`/map helpers/`buildTargetBasename`) and guarded `main()` in convert-to-webp/rename-enemies; `buildTargetBasename` also fixes a trailing-dash name when no English token exists. Coverage 56.8 → 59.7 stmts / 61.2 → 64.0 funcs (ocr-clan 0→51%, ocr-enemy 0→34%, convert-to-webp 0→29%, rename-enemies 0→31%, ocr-enemy-power 20→49%); 4 new files, +19 tests |
| 18 | Declarative OCR recognition matrix (§2.9) | **done** | `NAME_RECOGNITION_GROUPS` (4 groups / 16 variants: crop, width, threshold, worker, psm, whitelist) with a cached buffer per crop/threshold and one group runner; the early exit reads the first group and the Latin repair group is `onlyWhen: "tight"`. Arena A/B on 10 real screenshots byte-identical; clan eval unchanged; `ocr-name-heuristics.test.ts` +2 |

| 19 | Coverage to the practical maximum | **done** | Generated-image + fake-worker OCR flow, stubbed-`fetch` vision client, synthetic end-to-end battle, matrix/table generation over temp folders, evaluator summary extraction, rename plan/apply helpers, per-module error paths; 59.7 → **93.8 stmts / 82.5 branch / 82.7 funcs**; thresholds 93/81/81/93; 41 files / 358 tests. The manual `run-llm-real-test.mjs` LM Studio script is excluded from coverage. Remaining gaps are `main()` wrappers that call `process.exit`, live-service/child-process branches, and platform-specific failure paths |
| 20 | clan-clash helpers + runner map path | **done** | `runClanClash`, `processFolder`, `runWikiTable(sAfterConvert)`, `runNode`, discovery helpers exported and tested with an injected runner and temp trees (clan-clash 45% → **91%** stmts, 94% funcs); runner map tests seed a dated folder under `data/clan_clash` to cover existing-webp skips and map-only rows (run-extraction 62% → **82%** stmts, 100% funcs) |

| 21 | Arena OCR evaluation harness + tuning | **done** | Shared `ocr-eval.mjs` (metrics, fixture runner, CLI body) + `eval-arena-ocr.mjs` + tuning and holdout fixtures. Fragment clipping, phrase scoring, junk penalties, weighted all-variant votes, vote-gated Latin lookalikes, clean-primary overrides (junk/all-caps-Cyrillic winners) and phrase-wide noise judgement lifted tuning-set similarity **40.2% → 83.0%** (3/12 exact, power 10/12) and held-out similarity **43.2% → 77.9%** (3/12 exact); clan eval also improved to 93.2% (OCR-only 59.1%); `arena-eval.test.ts` guards both fixtures and their disjointness |

Current suite: `pnpm test:unit` 42 files / 378 tests; `pnpm check:imports` 85 files; `pnpm eval:clan-ocr` 11/12 exact, 93.2% overall, OCR-only 59.1%, power 12/12; `pnpm eval:arena-ocr` 3/12 exact, 83.0% similarity, power 10/12 (holdout 77.9%); `convert --extractor ocr` smoke persists `data.json` once per run and leaves no `.tmp` files.

All items from §5, all four §3.1 options, the §3.2 retry budget, the §2.2 config table, the §2.7 fallback diagnostics, the §4 CLI test gap, the §2.9 recognition matrix and an arena OCR evaluation harness are addressed. The only remaining note is the `clearPredictionCacheBeforeEachCall` A/B (§3.2), which needs a live LM Studio.

