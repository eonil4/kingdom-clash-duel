📊 Script Folder Analysis Summary


∴︎ Thought for 23s (click or ctrl+o to expand)
Scripts in scope: 21 files across scripts/llm/, scripts/ocr/, scripts/, data/battle/scripts/, doc/
- LLM scripts: 10 .mjs files in scripts/llm/ (enemy extraction, clan formation, conversion, wiki generation)
- OCR scripts: 6 .mjs files in scripts/ocr/ (Tesseract-based name/power recognition)
- Main orchestrators: clan-clash.mjs, convert-with-llm.js, convert2.js
- Tests: 6 test files in scripts/llm/test/ and scripts/ocr/tests/unit/

---

🔴 Critical Issues (Blockers)

1. Duplicate Conversion Scripts
Files: scripts/llm/convert.js, convert-with-llm.js, convert2.js  
Issue: Three nearly-identical entry points causing confusion and maintenance debt. convert.js and convert2.js are 85% identical; both serve the same core purpose (LLM extract + WebP convert).

Impact:
- Confusing CLI entry points for scripts
- Duplicate logic with minor differences (crop-based extraction vs direct extraction)
- Hard to keep features synchronized across all three

2. Outdated `convert.js` File
File: scripts/llm/convert.js  
Issue: Contains legacy code (delay() function, simpler LLM flow) that's been superseded by the more robust convert2.js and convert-with-llm.js. The file still references fileMap.json paths in comments despite per-folder data.json being used.

3. Hardcoded Dependencies & Runtime Failures
Files: Multiple scripts  
Issues:
- Scripts assume .webp outputs exist for "skip" logic but don't verify source files exist
- Some code silently ignores errors on data.json writes
- No graceful handling for missing LM Studio vision model at runtime

---

🟡 High Priority Issues (Should Fix Soon)

4. Missing Error Handling for LM Connection
Files: llm-enemy-extract.mjs, llm-formation-extract.mjs  
Issue: If LM Studio is unavailable, scripts throw generic "Cannot reach LM Studio" errors without user-friendly hints or alternative workflows.

5. No Validation of LLM Response Quality
Files: All extraction scripts  
Issue: Scripts assume the LLM returns valid JSON with power and name fields but don't validate the response structure before processing. Failed extractions just log errors and continue.

6. File Path Normalization Inconsistencies
Files: Most scripts  
Issue: Mix of POSIX/Windows path separators (path.posix.basename vs native path.basename) can cause issues on Windows when cross-platform testing occurs.

7. Memory Leaks in OCR Scripts
Files: ocr-enemy.mjs, ocr-enemy-name.mjs, ocr-enemy-power.mjs  
Issue: Tesseract workers are created once per script execution but never cleaned up on error paths (only in finally).

---

🟢 Low Priority Issues (Nice-to-Have)

8. No Logging/Telemetry for Processing Statistics
Files: All conversion scripts  
Issue: Scripts output basic counts (converted/skipped) but lack structured logging for debugging performance issues or detecting slow LLM responses.

9. Redundant `show-llm-config.mjs` Output Parsing
File: scripts/llm/show-llm-config.mjs  
Issue: Uses dotenv.config() which can cause silent failures if .env.local doesn't exist, making it hard to debug missing config values.

10. Missing Type Safety for Async Functions
Files: Multiple .mjs files  
Issue: No explicit ReturnType annotations for async functions in TypeScript-compatible code (though mostly JS, some type hints are present).

---

🔧 Refactoring Suggestions by Priority

Priority 1: Consolidate Entry Points
Replace the three conversion scripts with a single entry point using a dispatcher pattern.

// New structure: convert.mjs (single source of truth)
export async function extractAndConvert({ 
  image, 
  model, 
  force = false, 
  cropNamePowerOnly = false // new flag for convert2-style behavior
}) {
  if (cropNamePowerOnly) {
    return await extractEnemyDataFromNamePowerCrops(image);
  }
  return await extractEnemyDataFromScreenshot(image);
}

Benefits:
- Single codebase to maintain
- Consistent error handling
- Clearer documentation of available modes

---

Priority 2: Add Comprehensive Error Handling

Add structured logging and better error messages across all scripts.

Example fix for `llm-enemy-extract.mjs`:
try {
  const result = await extractEnemyDataFromScreenshot(imagePath, options);
  if (!result.power || !result.name) {
    throw new Error(`LLM returned invalid data: power=${result.power}, name=${result.name}`);
  }
  // validate response...
} catch (err) {
  console.error(`[Error] Failed to extract data from ${imagePath}:`, err.message);
  return { success: false, error: err.message };
}

---

Priority 3: Add Type Definitions

Create a types.ts file in scripts/llm/ and scripts/ocr/ with shared interfaces.

// scripts/llm/types.ts
export interface EnemyExtraction {
  power: number;
  name: string;
  language?: string;
  nameLatin?: string;
  englishName?: string;
}

export type ExtractMode = 'direct' | 'crop-name-power';

Priority 3: Add Type Definitions

Create scripts/llm/types.ts with shared interfaces for consistency across extraction scripts.

Benefits:
- Type-safe LLM calls
- Better IDE autocompletion
- Easier refactoring when changing response formats

---

Priority 4: Validate File Paths Before Operations

Add checks in convert.js, convert2.js to verify source PNG files exist before attempting extraction or WebP conversion. Prevents silent failures when folder structure changes.

---

Priority 5: Graceful LM Studio Degradation

Add fallback logic in llm-enemy-extract.mjs and llm-formation-extract.mjs:

1. Try to load vision model
2. If fails with "No vision" error, exit with helpful message suggesting manual setup
3. Don't silently continue with undefined model settings

---

Priority 6: Memory Leak Fix for Tesseract

In ocr-enemy-name.mjs, ocr-enemy-power.mjs, ensure workers are always terminated even on unexpected errors:

// Move worker cleanup earlier
try {
  const name = await ocrEnemyName(resolved, worker, workerRus);
} catch (err) {
  console.error(err.message);
} finally {
  await worker.terminate();
  await workerRus.terminate(); // Always terminates, even if err above threw
}

---

Priority 7: Structured Logging for Debugging

Add --verbose flag or logging level configuration to output processing durations per image, success/failure counts by reason. This helps identify which LLM/OCR calls are timing out or failing.

---

Priority 8: Fix `show-llm-config.mjs` Detection

Use direct file reading instead of dotenv.config():

let envLocal = {};
try {
  const fs = await import('fs/promises');
  const raw = await fs.readFile(ENV_LOCAL, 'utf8');
  envLocal = JSON.parse(raw);
} catch {} // Ignore if file missing
