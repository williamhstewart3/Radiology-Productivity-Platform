# PowerScribe browser OCR benchmark

The benchmark is intentionally local and development-only. It does not upload or persist screenshot pixels.

## Fixture requirements

Use a clean clipboard screenshot from the actual PowerScribe window, cropped so no patient identifiers are present. Do not commit real clinical screenshots. Keep local fixtures outside the repository or in an ignored local-only folder.

For every visible row, manually verify all three strings exactly as displayed:

```ts
{
  procedure: 'MRI CERVICAL SPINE W CONTRAST',
  examDate: '7/16/26 8:15 AM',
  modifiedDate: '7/16/26 8:42 AM',
}
```

The expected-row count must equal the geometric row-band count. This prevents a missing row from being hidden by aggregate character accuracy.

## Runner

`runPowerScribeOcrBenchmark` in `packages/web/src/web/utils/powerScribeOcrBenchmark.ts` accepts:

- the original PNG `File` or `Blob`;
- the verified Procedure, Exam Date, and Modified column rectangles;
- the verified geometric row bands;
- exact expected text for every cell;
- optional preprocessing variants and OCR engine.

It runs each variant directly from the original image, records preprocessing and OCR time separately, and reports:

- Procedure character and exact-cell accuracy;
- Exam Date character and exact-cell accuracy;
- Modified character and exact-cell accuracy;
- exact full-row accuracy;
- total time.

Every result stores the preprocessing configuration and the Tesseract configuration together: recognition layout, PSM, field whitelist policy, DPI hint, dictionary policy, and persistent-worker strategy. Image settings and OCR-engine settings are never ranked independently.

`rankPowerScribeBenchmarkResults` ranks exact full-row accuracy first, then aggregate field character accuracy, then the faster pipeline. This selects the smallest/faster treatment only when accuracy is tied.

## Default comparison matrix

The centralized matrix covers:

- grayscale at 1x, 2x, 3x, and 4x;
- percentile contrast stretching;
- local contrast enhancement;
- three global thresholds;
- adaptive thresholding at 2x, 3x, and 4x;
- light denoising;
- mild and moderate sharpening.

ClearType-aware candidates include original RGB, ordinary luminance, green-channel-only, and minimum-RGB-channel inputs. The original RGB candidate remains RGB only when no grayscale-only contrast, threshold, denoise, or sharpening operation is requested.

## Staged search

`POWERSCRIBE_STAGED_SEARCH` defines the permanent search order:

1. engine baseline: stacked single-block versus persistent-worker individual-cell single-line/single-word, field whitelists, dictionaries, and 200/300/400 DPI;
2. 1x/2x/3x/4x scale;
3. original RGB/luminance/green/minimum-channel treatment;
4. contrast;
5. threshold;
6. sharpening;
7. denoising only when it improves noisy cases;
8. targeted threshold/PSM, grayscale/threshold, and scale/sharpening interactions.

Only the first stage is generated automatically. Feed its winner into the next stage instead of creating a full Cartesian grid.

## Engine and worker behavior

Production currently uses one persistent module-level Tesseract worker and three stacked-column recognitions. It does not initialize a worker per cell. The benchmark can alternatively perform 204 individual-cell recognitions for a 68-row capture, still sequentially reusing that same worker, so cell-oriented PSM settings are evaluated correctly. A worker pool is not enabled without measured latency benefit because extra workers duplicate language-model memory and may increase browser contention.

Sparse-text PSM is intentionally outside the initial matrix because these cells are structured lines, not sparse pages. Add it only after a fixture failure provides evidence that it may help.

The production engine configuration remains `stacked-single-block-field-dpi300-no-dict-v1`. Procedure cells allow uppercase letters, legitimate digits, spaces, radiology punctuation, and a visible ellipsis. Timestamp cells allow only digits, `/`, `:`, spaces, and `A/P/M`.

## Permanent fixture contract

`PowerScribeBenchmarkFixtureManifest` requires a source PNG path, exact column and row geometry, exact visible Procedure/Exam Date/Modified truth, interface-state metadata, and an optional checked-in baseline. Fixture-suite validation requires coverage for:

- normal and selected/highlighted rows;
- tan or alternating backgrounds;
- priority icons;
- text next to column boundaries;
- a representative 68-row capture;
- an actually visible truncated procedure.

Never commit an identifiable clinical screenshot. The real-image baseline remains intentionally absent until a deidentified fixture and its cell truth are reviewed. Do not substitute a synthetic image and call it representative.

Run the permanent logic/contract subset with:

```sh
bun run test:ocr-regression
```

When the reviewed PNG fixture is added, extend this command with its browser test. `evaluatePowerScribeBenchmarkBaseline` provides the CI failure gate for procedure accuracy, timestamp accuracy, full-row accuracy, and median processing time.

## Performance budget

The provisional full 68-row warm-capture budget is 30 seconds median. The harness records image decode, crop/split, preprocessing, one-time worker initialization, OCR recognition, institutional-vocabulary resolution, warm total, cold total including initialization, effective per-cell OCR time, and JavaScript heap delta when Chromium exposes it. Run at least three repetitions before establishing or changing a baseline. Worker initialization is reported separately and occurs once per benchmark run.

Accuracy remains primary, but configurations with equivalent accuracy are ranked by median time and simplicity.

## Institutional vocabulary and truncated cells

The benchmark accepts a `resolveWithInstitutionVocabulary` callback specifically so resolution goes through the existing W5 institutional vocabulary ladder. It does not contain a second procedure spell checker or dictionary. OCR scoring compares exact visible text first; resolution scoring separately compares the W5 output and captures confidence, explanation, and review behavior.

For long cells, ground truth is the rendered visible text. Mark it as fully visible, truncated with a visible ellipsis, or truncated without an ellipsis. Hidden characters are never included in OCR truth. `expectedResolvedProcedure` records the full institutional title only for the separate W5 resolution score.

The production configuration remains `adaptive-balanced-v1`, which preserves the previously shipped scale selection, nearest-neighbor resize, contrast, adaptive-threshold values, and zero added row padding. High-quality interpolation and one source pixel of vertical padding are benchmark candidates, not unmeasured production changes. Do not select a different production variant until a representative, manually verified fixture set demonstrates higher full-row accuracy.

## Source display comparison

Benchmark separate clean screenshots for each proposed source configuration:

- current PowerScribe font size and Arial Regular;
- larger font size with the same visible table width;
- Arial Bold at both sizes if available.

Record the number of useful visible rows along with OCR accuracy and time. Bold or larger text wins only when measured full-row accuracy improves enough to justify reduced row density.
