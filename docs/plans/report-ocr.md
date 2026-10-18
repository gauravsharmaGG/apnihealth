# Plan: reading values from uploaded lab reports (on-device OCR + mapping), with an optional AI path later

Status (Oct 18, 2026): **plan only.** No code, no dependencies added, no services set up. Base: `main` at `de33c1d`.
Built with Grok only (no claude/codex/claude-glm CLIs). Runs on both targets: Node (`node:sqlite`) and Cloudflare
Workers + SQLite in a Durable Object (apni.health).

Agreed direction:
- **Phase 1 (on-device, private):** text extraction from PDFs and OCR for photos and scans run in the user's browser.
  A mapping step matches names, units and reference ranges to the marker catalog, with German, English and Hindi
  aliases and unit conversion. The user always reviews and confirms before anything is saved, and the original file
  stays attached. The server only ever receives the confirmed values, never the OCR text.
- **Phase 2 (later, opt-in):** extraction by an outside AI model, with explicit consent, a data processing agreement
  (DPA) and a privacy notice entry.

---

## 1. What exists today

| Piece | Where | Notes that matter for this plan |
|---|---|---|
| Record inbox (uploads) | `events.mjs` (`addInbox`, `inboxFile`, `deleteInbox`), table `inbox_items` (JSON doc per member, migration 1), API `GET/POST/DELETE /api/inbox`, `GET /api/inbox/:id/file` | Categories include `lab-report`. JPG/PNG/WebP/HEIC/PDF, max 8 MB, sent as base64 JSON. Every item gets `status:'needs-review'`, and nothing ever changes it. Files go through `blobs.mjs` (fs on Node, R2 on Workers), key `profiles/<id>/uploads/<uuid>.<ext>`. No content hash is stored. |
| Inbox UI | `public/child.js` ("record inbox (any profile)"), `templates/index.template.html` (`data-inbox`) | Upload form plus a "Saved records" list. Adults get `lab-report`, `medical-document` and `other`. Files open in `doc.html`/`doc.js` (viewer for `/api/inbox/<id>/file`). |
| Episode attachments | `events.mjs` `link:{type:'upload',ref}`, `public/episodes.js` | An episode entry can point to an inbox item. |
| Lab reports and values | `labs.mjs`, tables `lab_reports`, `lab_values`, `lab_pending` (migration 2), API `GET/POST /api/labs`, `DELETE /api/labs/:id` | `validateReport` rejects any name the catalog doesn't know (it returns `unknown[]`). `source` must look like `name.pdf` or `.md`, so a photo can't be linked, and there is no link to an inbox item. A value is stored **as reported** (`value` text, `num`, `unit`, `reference`, `flag` high/low, `page`). There is no canonical marker column (resolved at read time in `series()`), no provenance and no confidence. Max 200 values per report, 256 KB body. |
| Marker catalog | `config/markers.default.json` (109 markers in 10 groups; fields `name`, `group`, `meaning`, `aliases`), merged with optional `private/markers.json` (Node only), `GET /api/labs/catalog` | Only 65 markers have aliases (67 in total), all English short forms (`LDL`, `ALT`, `MCV`…). **No units, no preferred unit, no reference or plausible ranges, no German or Hindi names.** Matching is exact and case-insensitive on name or alias. On Workers there is no `private/markers.json`, so a household can't add markers there. |
| Labs UI | `public/labs.js` (explorer data via `window.setLabData`, report list, "Add results" dialog with a `<datalist>` of names), `public/app.js` (explorer) | Adults only (`kind==='adult'`). The manual form is the natural place for the review step's fields. |
| Old import | `importer.mjs` (reads `private/lab-values.json`) | It's what produced the earlier finding: **38 markers in Gaurav's real data don't map to the catalog** (shown under "Other"). |
| Export | `datarights.mjs` (all member-scoped tables plus files) | A new household-scoped table must be added to the export explicitly. |
| Static files and headers | `app.mjs` `serveStatic`, `http.mjs` | The MIME allowlist has **no `.mjs`, `.wasm` or `.gz`** (they'd return 404). Every response is `Cache-Control: private, no-store`, so multi-MB OCR assets would be downloaded again on every use. The CSP is `script-src 'self'` with no `'wasm-unsafe-eval'`, so **WebAssembly is blocked today**. `img-src 'self'` means no `blob:` previews. |
| Service worker | `public/sw.js` (`apnihealth-v10`) | Caches every same-origin GET at runtime (network first). The OCR assets should be excluded. |
| Precedent for testable shared code | `public/ahparse.js` + `test-ahparse.mjs` | Pure browser module tested from Node. The mapping engine follows the same pattern. |

---

## 2. Phase 1 options: extracting text on the device

### 2.1 Text PDFs: pdf.js (`pdfjs-dist`)
- Latest **6.4.299**, **Apache-2.0** (npm registry, checked Oct 18, 2026). Apache-2.0 code can be combined with AGPL-3.0.
- Sizes measured from the npm tarball (raw / gzip -9):

  | File | Raw | gzip |
  |---|---|---|
  | `build/pdf.min.mjs` | 459 KB | 131 KB |
  | `build/pdf.worker.min.mjs` | 1.26 MB | 375 KB |
  | `legacy/build/pdf.min.mjs` + worker | 524 KB + 1.32 MB | 151 KB + 391 KB |
  | `wasm/openjpeg.wasm` (JPEG 2000) | 251 KB | 82 KB |
  | `wasm/jbig2.wasm` | 104 KB | 41 KB |
  | `wasm/qcms_bg.wasm` (ICC colour) | 97 KB | 35 KB |

  For text extraction we need only `pdf.min.mjs` and the worker. The wasm decoders matter only when we **render** a
  scanned PDF page for OCR. Since v5 they load from `wasmUrl`, and there's a slower JS fallback without WebAssembly [2].
- `getTextContent()` returns each text run with its transform (x, y), so table rows can be rebuilt from coordinates.
  It's exact for text-native PDFs, which is what lab portals usually issue. A page with almost no text items is
  treated as scanned and goes to OCR.
- Browser support: the modern build targets current browsers. The `legacy` build lists "Safari 18+: mostly" [3].
  **Decision:** ship the modern build and test on Gaurav's iPhone. Fall back to the legacy build only if iOS fails.
- CSP: `isEvalSupported` was removed in 5.7 because the eval path no longer exists [4]. No `new Function` call was
  found in the 6.4.299 worker (grep). The worker loads as a same-origin module worker (`workerSrc`), which
  `script-src 'self'` allows. The wasm decoders need `'wasm-unsafe-eval'`.

### 2.2 OCR for photos and scans: tesseract.js
- **tesseract.js 7.0.0** (API and worker, Apache-2.0) uses **tesseract.js-core ^7.0.0** (Apache-2.0) (npm registry).
  Measured sizes:

  | File | Raw | gzip |
  |---|---|---|
  | `tesseract.min.js` | 63 KB | 10 KB |
  | `worker.min.js` | 111 KB | 34 KB |
  | core `tesseract-core-{,simd-,relaxedsimd-}lstm.wasm.js` (wasm embedded, one is chosen per device) | 3.90 MB each | 1.46 MB each |

  Use the **LSTM-only** cores. The legacy-engine cores are larger (core 6.1.2: 4.75 MB). tesseract.js chooses
  relaxed-SIMD, then SIMD, then plain at runtime, so when `corePath` is a directory all three must be served [1, source
  `getCore.js`]. **iOS:** wasm SIMD is supported from Safari/iOS 16.4 [9]. Older devices get the plain core (slower).
- **Language data** (`*.traineddata.gz`, fetched and gunzipped by tesseract.js itself, IndexedDB-cached by default
  [1]). Sizes measured from `@tesseract.js-data/*` 1.0.0:

  | Lang | `4.0.0_best_int` (LSTM-only default) | `4.0.0` (incl. legacy) | Upstream tessdata_fast (raw) |
  |---|---|---|---|
  | eng | 2.95 MB | 10.9 MB | 5.48 MB [5] |
  | deu | 1.33 MB | 7.10 MB | 1.53 MB [5] |
  | hin | 1.39 MB | 1.40 MB | 1.12 MB (4.1.0) [5] |

  Upstream model licence: **Apache-2.0** (tessdata_fast and tessdata_best LICENSE files). The npm wrapper says MIT.
  We vendor the upstream files with the Apache notice. Load languages **lazily**: eng+deu by default (lab reports
  mix German names with English abbreviations), and hin only when the user chooses it. Indian lab reports are
  mostly printed in English, so `hin` is for the rare Devanagari report.
- **First OCR on a device** downloads one core plus eng+deu: about 1.5 + 2.95 + 1.33 ≈ **5.8 MB** compressed (the
  traineddata is already gzipped; the core compresses if the server does). Node's `serveStatic` doesn't compress,
  so the core costs 3.9 MB there.
- **Tables:** Tesseract is weak on tabular layouts. The docs recommend PSM 4 (single column of variable sizes) or
  per-line/cell OCR, plus deskewing, binarising and enough resolution; text in tables is a known issue [6, 7]. Plan:
  use word bounding boxes (tesseract.js returns blocks, lines and words with bbox and confidence) and run the
  **same coordinate-based row rebuilder** as for PDF text. Render or scale pages to a sensible size and grayscale
  first. Try PSM 4 vs 6 vs 11 on fixtures and pick by measured accuracy.
- **CSP / self-hosting** (no CDN): set `workerPath`, `corePath` (directory) and `langPath` to our own `/vendor/...`
  URLs, and set **`workerBlobURL:false`**. The default spawns a `blob:` worker, which our CSP blocks [1, 8]. The
  wasm needs `script-src 'self' 'wasm-unsafe-eval'`, which is supported from Safari/iOS 16.0, Chrome 97 and
  Firefox 102 [10]. It allows wasm compilation only, not JS `eval` [11].

### 2.3 Alternatives considered
- **Scribe.js** (`scribe.js-ocr` 0.16.1, **AGPL-3.0**, builds on Tesseract.js). Its authors say it's more accurate
  than Tesseract.js, has native PDF text extraction, must be served same-origin and has no UMD build [12]. The
  licence works for us since apnihealth is AGPL-3.0. Cons: much bigger (46 MB unpacked on npm vs 1.4 MB +
  core) and a larger API surface to vendor. **Keep it as a fallback** if fixtures show tesseract.js + our row
  rebuilder isn't good enough on tables.
- **Cloud OCR** is better on hard cases (handwriting, complex tables, poor photos) [13]. That is phase 2.
- Not evaluated in depth: ONNX-based OCR (PaddleOCR via onnxruntime-web). Model size and iOS performance are unknown.

### 2.4 iOS Safari and devices
- WebAssembly with our CSP needs iOS 16.0+ [10]. SIMD needs 16.4+ [9].
- HEIC: Safari 17+ decodes HEIC (`createImageBitmap`) [9]. On older iOS, ask for a JPG (the iOS photo picker
  usually hands over JPEG; verify on the device).
- Memory: process pages **one at a time**, cap pages per run (proposal: 10), downscale big photos before OCR,
  `terminate()` the worker afterwards and run it all in a Web Worker so the UI stays responsive. No timing or
  memory numbers are claimed here; we measure them on Gaurav's iPhone in PR 6.

### 2.5 Serving the assets ourselves
- **Vendoring, not npm deps:** `package.json` stays dependency-free. A script `scripts/vendor-ocr.mjs` downloads
  pinned tarballs from the npm registry, **checks sha256 against `vendor/ocr.lock.json`**, and copies only the needed
  files plus their LICENSE/NOTICE into `public/vendor/ocr/<version>/`.
  - **Decision for Gaurav:** (a) commit the files (about 20 MB: pdf.js ~1.8 MB + 3 cores 11.7 MB + tesseract.js
    0.2 MB + eng/deu/hin 5.7 MB; reproducible, works offline for self-hosters) or (b) gitignore them and run the
    script in `build.py`/CI/deploy (slim repo, but builds need the registry). Recommendation: **(b)** with hashes
    pinned in the repo. Option (a) bloats every clone forever.
- Workers static assets: max **25 MiB per file**, 20,000 files (Free) / 100,000 (Paid) [14]. The largest file is
  3.9 MB, so we're fine.
- Server changes: add MIME types `.mjs` → `text/javascript`, `.wasm` → `application/wasm`, `.gz` →
  `application/octet-stream` (**no** `Content-Encoding`, because tesseract gunzips it itself). Give `/vendor/ocr/<version>/*`
  `Cache-Control: public, max-age=31536000, immutable` (a new version means a new path). `sw.js` skips `/vendor/`.
- CSP: add `'wasm-unsafe-eval'` to `script-src`. Everything else stays (`worker-src` falls back to `script-src
  'self'`, `connect-src` falls back to `'self'`). Page previews use `<canvas>`, so `img-src` needs no `blob:`.

---

## 3. The mapping step

All of it lives in one pure module, `public/labmap.js` (no DOM), tested from Node like `ahparse.js`. The browser
runs it after extraction. The same code maps phase-2 AI output later.

### 3.1 From text to rows
1. **Tokens:** `{text, x0, y0, x1, y1, page, conf}` from pdf.js text items (conf = 1) or tesseract words.
2. **Lines:** group by baseline (y within a tolerance relative to text height), then sort by x. Join tokens when the
   gap is small, otherwise start a new cell. Handle two-column layouts by splitting at a large consistent x gap.
3. **Header detection** (optional help): find column headers (`Test/Parameter/Untersuchung`, `Ergebnis/Result/Wert`,
   `Einheit/Unit(s)`, `Referenz/Normbereich/Bio. Ref. Interval/Reference range`) and use their x positions to assign
   cells to columns.
4. **Row grammar** per line: `name` (leading text) · `value` (first numeric token: decimal comma or point, `<`/`>`/
   `≤`/`≥` prefix, `neg./pos./positiv/negativ` as text values) · `flag` (`H`/`L`/`+`/`-`/`*`/`↑`/`↓`/`hoch`/`niedrig`)
   · `unit` (match against a unit lexicon: `mg/dl`, `mmol/l`, `µmol/l`/`umol/l`, `g/dl`, `g/l`, `U/l`/`IU/L`,
   `ng/ml`, `µg/l`, `pg/ml`, `pmol/l`, `%`, `fl`, `pg`, `/µl`, `Tsd/µl`, `Mio/µl`, `10^9/l`, `10^3/µl`, `mIU/l`,
   `µIU/ml`, …) · `range` (`a - b`, `a–b`, `< b`, `> a`, `bis b`, `up to b`).
   OCR fixes apply **only inside numeric cells**: `O→0`, `l/I→1`, `S→5` and so on.
5. **Report metadata:** report and sample date (`Befunddatum`, `Eingangsdatum`, `Abnahme`, `Datum`, `Collected on`,
   `Reported on`, `Sample date`), and lab name as a title suggestion. Patient name, birth date and IDs are **never
   extracted or stored**.
6. Lines that don't parse are kept as "unread lines" in the review screen (collapsed), so the user can see what was
   skipped. They're never saved.

### 3.2 Matching names to the catalog
- **Normalise:** lowercase, NFKC, remove accents for matching only (`Hämoglobin` → `hamoglobin`, also `ae/oe/ue`
  variants), drop punctuation, method suffixes (`(Photometrie)`, `, enzymatisch`), specimen tags (`i.S.`, `im Serum`,
  `EDTA`, `Serum`, `Plasma`) and footnote marks.
- **Order:** (1) exact name/alias, (2) normalised alias, (3) **household aliases** learned from earlier confirmations,
  (4) fuzzy (Jaro-Winkler or Damerau-Levenshtein ratio) **only for normalised names of 6+ characters**, never
  for abbreviations.
- **Confusable guard:** never fuzzy-match within known pairs (ALT/ALP, AST/ALT, LDL/HDL, MCH/MCHC, T3/T4, fT3/fT4,
  Hb/HbA1c, CK/CK-MB, Neutrophils % vs absolute, the `% of expected` vs absolute volume markers). For share-vs-count
  pairs, **the unit decides** (`%` → share, `/µl` or `10^9/l` → count).
- **Unit as a tie-breaker:** e.g. `HbA1c` with `%` → "Average blood sugar (HbA1c)", with `mmol/mol` → "Average blood
  sugar: alternate units".
- **Catalog v2** (PR 1) adds per marker: `unit` (preferred display unit), `units` (accepted units with conversion),
  `plausible` `[min,max]` (sanity bounds to catch decimal errors, **not** medical reference ranges), and more
  aliases in **German** (`Hämoglobin`, `Leukozyten`, `Thrombozyten`, `Erythrozyten`, `Kreatinin`, `Harnsäure`,
  `Harnstoff`, `Cholesterin gesamt`, `Triglyceride`, `Nüchternglukose`, `Ferritin`, `Eisen`, `Transferrinsättigung`,
  `Gamma-GT`, `GOT`/`GPT`, `Bilirubin gesamt`, `Kalium`, `Natrium`, `Calcium`, `Magnesium`, `Vitamin D (25-OH)`…),
  **English variants** (`SGPT`/`SGOT`, `Fasting Blood Sugar`, `Glycated haemoglobin`, `TLC`, `Platelet count`,
  `PCV`…) and **Hindi** (Devanagari forms of the common names, e.g. `हीमोग्लोबिन`, `कोलेस्ट्रॉल`, `शुगर (खाली पेट)`). The
  Hindi list stays short and is reviewed by Gaurav, since printed Indian reports are rarely in Hindi.
- **The 38 unmapped markers in Gaurav's data:** a small local script (`scripts/unmapped-markers.mjs`, PR 8) lists
  stored marker names that the catalog doesn't resolve, **names and counts only, no values**. Gaurav runs it (or
  approves running it) on the Mac test copy. Generic lab names then become aliases in the public catalog, and
  anything personal goes to his household's own markers. Real data never goes into the repo.

### 3.3 Unit conversion
- **Store as reported, convert for display.** `lab_values.value/unit/num` keep exactly what the report says
  (auditable against the attached original). `series()` converts points to the marker's preferred `unit` for the
  chart and shows the original on tap. A report that already uses the preferred unit is unchanged.
- Conversions are declared in the catalog as `{from, to, factor}` or a named function for non-linear cases (HbA1c %
  ↔ mmol/mol uses the IFCC/NGSP master equation). Initial set: glucose, cholesterol fractions, triglycerides,
  creatinine, urea (and BUN ↔ urea, with an explicit label), uric acid, bilirubin, calcium, magnesium, phosphate,
  iron, vitamin D, B12, folate, hemoglobin (g/dl ↔ g/l ↔ mmol/l), cell counts (`/µl`, `Tsd/µl`, `10^3/µl`, `10^9/l`;
  `Mio/µl` ↔ `10^12/l`), identities (`ng/ml` = `µg/l`, `mIU/l` = `µIU/ml`, `U/l` = `IU/l`).
- **Every factor in PR 1 comes with a citation in the JSON (`src`) and a round-trip test.** No factor goes in
  without a source. An unknown unit for a known marker means no conversion: the value is saved as reported and
  shown "in original units", and the review flags it.
- Reference ranges are stored as printed (they belong to that lab and method) and are **never** converted into
  targets.

### 3.4 Confidence and the review screen
- Score per row from: name match type (exact 1.0 > alias > household alias > fuzzy ratio), OCR word confidence for
  the value cell (1.0 for PDF text), unit known for the marker, value inside `plausible`, and flag consistent with
  value and range (e.g. `H` but value below the range lowers the score).
- **Buckets:** high = ticked; medium = ticked and highlighted ("check this"); low or unmapped = **unticked** and
  needs a choice. Nothing is saved unless the user taps **Save**.
- **Review screen** (dialog, 390x844 first): report date (proposed, editable, required), title, then one row per
  result: original line (read-only), marker picker (catalog + household markers), value, unit (+ "≈ x preferred
  unit" hint), range, flag, confidence badge, include checkbox, and a page thumbnail with the cell highlighted when
  available (canvas, no `blob:`). The "Screening" and "Preliminary" switches are the same as in the manual form.

### 3.5 Unmapped markers
For each unmapped row the user chooses:
1. **Map to an existing marker.** This also offers "remember for this household" (stores a household alias).
2. **Save as a custom marker** (household-scoped name, group "Other" or a chosen group, preferred unit).
3. **Skip** (the default).

On Workers there's no `private/markers.json`, so custom markers and aliases live in a **new DB table** (works on
both runtimes). The default catalog still merges first, then `private/markers.json` (Node), then household
markers. Custom-marker names can't collide with catalog names or aliases (case-insensitive).

### 3.6 Avoiding duplicates
- **File:** store `sha256` on each inbox item (computed server-side on upload). When the file already belongs to a
  saved lab report, show "Already imported on <date>" with the option to open it.
- **Report:** `POST /api/labs/check` (read-only) takes `{date, values:[{marker,num,unit}]}` and returns existing
  reports for the member on the same date with ≥ 80% overlap (same marker and equal value after unit
  normalisation). The review screen warns and offers to skip duplicate rows.
- **Within one report:** the same marker twice in the same unit keeps the first and flags the second. In different
  units, keep both only when the catalog has an alternate-units marker (HbA1c); otherwise keep the first.
- **Marking done:** after saving, the inbox item gets `status:'imported'` and `labReportId`, and the lab report gets
  `upload_id`. Deleting the report keeps the file (it's the user's record). Deleting the file is refused while a
  report links to it, unless the user also removes the link (decision below).

### 3.7 Data model changes (one additive migration, v10)
- `lab_reports ADD COLUMN upload_id TEXT` (inbox item id; validated to belong to the member). `source` validation
  is relaxed to allow image names when `upload_id` is set.
- `lab_values ADD COLUMN marker TEXT` (canonical name resolved at save time), `raw_name TEXT` (as printed),
  `method TEXT CHECK(method IN ('manual','pdf-text','ocr','ai'))`, `confidence REAL`.
- `CREATE TABLE lab_markers(household_id, name, group_name, unit, aliases JSON, created_at, PRIMARY KEY(household_id,name))`
  for custom markers and learned aliases. Added to the ZIP export and to household deletion.
- Inbox items (JSON doc, no migration): `sha256`, `labReportId`, `status:'imported'`.

---

## 4. Phase 2 (later, opt-in): extraction by an outside AI model

- **Shape:** a server-side call (Worker or Node; the key is a secret and never reaches the browser). It sends the
  stored original from R2/fs to the provider, gets structured rows back, and feeds them through the **same
  `labmap.js` mapping and the same review screen**. Off unless `AI_EXTRACT_PROVIDER` and its key are configured
  (self-hosters opt in too).
- **Providers with EU processing (prices as published; recheck before choosing):**
  - Mistral OCR 4.1 on the EU endpoint `api.eu.mistral.ai`: $4 per 1,000 pages + 10% for EU = **$4.40 / 1,000
    pages** (~$0.013 for a 3-page report). The regional endpoint has no batch discount [15].
  - Azure Document Intelligence Layout (tables + text), EU regions such as Germany West Central / West Europe:
    **$10 / 1,000 pages** (S0) [16].
  - AWS Textract AnalyzeDocument with TABLES in eu-central-1: **$15 / 1,000 pages** (first 1M pages/month) [17].
  - Google Document AI or Gemini on Vertex AI in an EU region: not priced here; check if it's shortlisted.
- **Consent flow:** a household setting "Use <provider> to read reports" (owner only, off by default) with a plain
  explanation (what is sent, to whom, which country, retention). There is also a **per-report confirmation** each
  time ("Send this file to <provider> in <EU country>?"). Consent is recorded in `consents` with a separate
  purpose/version (Art. 9(2)(a) explicit consent) and can be withdrawn in Settings. The on-device path always stays
  available.
- **Paperwork before turning it on:** sign the provider's DPA (Art. 28), confirm zero or short retention and no
  training on inputs, add it to the sub-processor list and privacy notice (`docs/PRIVACY-TEMPLATE.md`), and update the
  records of processing.

---

## 5. PR series (phase 1)

Sizes are rough line counts of hand-written code (vendored files excluded). Every PR keeps `npm test` green on Node
and `test:workers` green. Every PR carries `MergeJudge-Actor: agent`. Merges follow Gaurav's OK.

| # | PR | Size | Main risks | Needs Gaurav's OK beyond the normal merge? |
|---|---|---|---|---|
| 1 | **Catalog v2**: `unit`, `units`+conversions (each with a source), `plausible`, de/en/hi aliases in `config/markers.default.json`. `labs.mjs` loader validates the new fields. `/api/labs/catalog` returns them. `test-labs.mjs` additions and conversion round-trip tests. | ~150 code + ~600 JSON | Wrong factor or alias (an ALT/ALP-style mix-up). Mitigated by citations, tests and the confusable list. | Hindi alias list review |
| 2 | **Mapping engine** `public/labmap.js` (normalise, match, fuzzy with guard, row grammar, unit conversion, confidence, in-report dedupe) + `test-labmap.mjs` on synthetic token/line fixtures (de, en, Indian-style English, one hin). | ~500 | Fuzzy false positives. Mitigated by the 6+ char rule, the guard and unit tie-break; low confidence is unticked. | – |
| 3 | **Data model**: migration v10 (`upload_id`, `marker`, `raw_name`, `method`, `confidence`, `lab_markers`), household markers in `catalog()`, custom markers and learned aliases on save, `POST /api/labs/check`, inbox `sha256` and `imported` status, export and delete coverage. Tests on Node and in the Workers flow. | ~350 | Migration on live DBs (Mac test copy, apni.health DO). Additive only; back up before deploying. | Deploy to apni.health and the Mac copy |
| 4 | **Synthetic fixtures + harness**: `scripts/make-report-fixtures.mjs` writes text PDFs (tiny hand-rolled PDF writer, no deps) and PNG "photos" (headless Chrome screenshot of an HTML report, plus rotated, blurred and low-contrast variants) with ground-truth JSON. Fake people and labs only (e.g. "Testlabor Musterstadt", "Test Person", year 2000 dates). | ~300 + fixtures (~1–2 MB) | Fixtures look nothing like real reports. Mitigated by copying real **layouts** (column order, German decimal comma, Indian "Bio. Ref. Interval") without any real values. | – |
| 5 | **Vendored OCR assets + serving**: `scripts/vendor-ocr.mjs` + `vendor/ocr.lock.json` (pdfjs-dist 6.4.299, tesseract.js 7.0.0, tesseract.js-core 7.0.0, eng/deu/hin traineddata, sha256 + LICENSE/NOTICE), `build.py` hook, MIME `.mjs/.wasm/.gz`, immutable cache for `/vendor/ocr/<ver>/`, `sw.js` skip, CSP `'wasm-unsafe-eval'`, CSP test update. | ~150 + assets | New third-party code. A loosened CSP (wasm only). If the CI workflow must run the vendor script, it touches `.github`. | **Yes**: new deps (vendored), CSP change, commit vs fetch decision, `.github` if touched |
| 6 | **Extraction worker** `public/report-extract.js` (module Web Worker): PDF text → tokens; scanned detection → render page → OCR; images → `createImageBitmap` → scale → OCR; lazy-loaded only on "Read values"; page cap; progress events; terminate after. Browser test runs fixtures end to end in headless Chrome. Manual check on Gaurav's iPhone. | ~400 | iOS memory and speed, Safari quirks (OffscreenCanvas availability; fall back to main-thread canvas), table accuracy. | iPhone test by Gaurav |
| 7 | **Review & confirm UI**: entry points "Read values" on inbox `lab-report` items and "Import from a report" in Labs. Review dialog (§3.4), unmapped choices (§3.5), duplicate warnings (§3.6), save via `POST /api/labs` with `uploadId`, link from the report to the original in `doc.html`. 390x844 browser test and screenshot. | ~450 | UX on small screens with 40+ rows; users trusting wrong values. Mitigated by mandatory review, unticked low-confidence rows and the original always one tap away. | – |
| 8 | **Docs + helper**: README section, privacy template line ("reports are read on your device; only the values you confirm are saved"), `AGENTS.md` notes, plan status, `scripts/unmapped-markers.mjs` (names and counts only). | ~150 | – | **Yes**: `AGENTS.md` (protected); running the script on the Mac copy |

**Order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. PRs 1, 2 and 4 don't depend on any new deps and can start right away. PR 5
is the approval gate for 6 and 7.

**Accuracy gate (PR 6/7):** on the synthetic set, field-level precision ≥ 0.98 for **saved-by-default** rows (high
bucket) on text PDFs. For photos the target is measured and reported rather than promised, and the thresholds are
fixed in PR 4 from the first measurements. Wrong-but-ticked is the failure that matters most.

**Test fixtures:** synthetic only, generated by a committed script, with clearly fake names and labs and dates in 2000.
No real reports, no real values, no screenshots of real data, and no OCR text in logs. CI never downloads
user files.

---

## 6. Open decisions for Gaurav
1. **Approve the vendored deps** (pdfjs-dist, tesseract.js, tesseract.js-core, tessdata eng/deu/hin; all Apache-2.0)
   and **commit vs fetch-at-build** (recommendation: fetch with pinned sha256).
2. **CSP:** allow `'wasm-unsafe-eval'` site-wide (simplest), or only on the app shell.
3. **Languages:** eng+deu by default, hin on demand. OK?
4. **Unmapped default:** skip (recommended) vs save as custom marker.
5. **Deleting a file that a lab report links to:** refuse (recommended) vs unlink and delete.
6. **Minimum iOS:** 16.0 (wasm under CSP). Below that, the "Read values" button is hidden.
7. **Running the unmapped-marker script on the Mac test copy** (names only) to fix the 38 unmapped markers.
8. **Phase 2:** provider shortlist (Mistral EU vs Azure EU), and whether it's ever enabled on the public apni.health.

## 7. Risks
- **Wrong values saved silently.** This is the main risk for health data. Mitigated by mandatory review, unticked
  low-confidence rows, plausibility bounds, the confusable guard, originals attached, and `method/confidence` stored
  so OCR-derived values can be shown with a marker and audited later.
- **Device limits:** large photos and multi-page scans on older iPhones. Mitigated by page cap, downscale,
  sequential pages and terminating the worker. Measured in PR 6, not assumed.
- **Payload:** about 6 MB on the first OCR use (cached afterwards). Only loaded on demand, never at app start.
- **CSP loosening:** `'wasm-unsafe-eval'` allows compiling any same-origin wasm. Acceptable because `script-src`
  stays `'self'` with no `unsafe-eval`.
- **Supply chain:** vendored binaries are pinned by sha256 and upgraded only by a PR that changes the lock file.
- **Migration on live data:** additive only, with a backup before the deploy on the Mac copy and apni.health.
- **Licences:** all phase-1 parts are Apache-2.0 (compatible with AGPL-3.0). Their notices ship next to the files.

## Sources (checked Oct 18, 2026)
Package versions, licences and file sizes in §2 were read from the npm registry and measured from the published
tarballs (`npm view` / `npm pack`) on the box.
1. tesseract.js API docs (createWorker options, corePath, langPath, workerBlobURL): https://github.com/naptha/tesseract.js/blob/master/docs/api.md · local installation: https://github.com/naptha/tesseract.js/blob/HEAD/docs/local-installation.md
2. pdf.js v5.0.375 release notes (wasmUrl, JS fallback): https://github.com/mozilla/pdf.js/releases/tag/v5.0.375
3. pdf.js FAQ, supported browsers: https://github.com/mozilla/pdf.js/wiki/frequently-asked-questions
4. isEvalSupported removed in pdfjs-dist 5.7: https://github.com/comisai/comis/commit/209a9030504ba6a781a70ee93dd332c4f6bc8203
5. tessdata_fast files: https://github.com/tesseract-ocr/tessdata_fast (eng/deu main, hin 4.1.0); licence: https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE
6. Tesseract "Improving the quality of the output": https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html
7. "Text in tables ignored": https://github.com/tesseract-ocr/tesseract/issues/1979
8. workerBlobURL and CSP: https://stackoverflow.com/questions/72186595
9. caniuse: wasm SIMD https://caniuse.com/wasm-simd · HEIF https://caniuse.com/heif · createImageBitmap https://caniuse.com/createimagebitmap
10. caniuse `wasm-unsafe-eval`: https://caniuse.com/mdn-http_headers_content-security-policy_script-src_wasm-unsafe-eval
11. MDN script-src: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src
12. Scribe.js vs Tesseract.js: https://github.com/scribeocr/scribe.js/blob/master/docs/scribe_vs_tesseract.md
13. Browser OCR vs cloud OCR: https://dev.to/helloashish99/ocr-in-the-browser-how-tesseractjs-makes-pdf-text-extraction-free-5ab2
14. Workers limits / static assets: https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
15. Mistral pricing and regional inference: https://docs.mistral.ai/inference/pricing · https://docs.mistral.ai/inference/regional-inference
16. Azure Document Intelligence pricing: https://azure.microsoft.com/de-de/pricing/details/document-intelligence/ · layout model: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout
17. Textract pricing: https://aws.amazon.com/textract/pricing/
