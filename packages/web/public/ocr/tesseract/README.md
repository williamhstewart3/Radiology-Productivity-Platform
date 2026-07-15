# Packaged Tesseract runtime

These files are shipped with the web app so browser OCR does not fetch worker, core, or language data from a CDN while processing a capture.

- `worker.min.js` and the files under `core/` come from the installed `tesseract.js` 7.0.0 / `tesseract.js-core` package.
- `lang/eng.traineddata.gz` is the English 4.0.0 model from the Tesseract.js Project Naptha language-data host.

Tesseract and its language data are licensed under Apache-2.0. See the dependency license and upstream model repository for notices.
