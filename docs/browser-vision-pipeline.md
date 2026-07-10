# Browser Vision Pipeline

Experimental branch: `feature/vision-pipeline`

This proof of concept adds a browser-local Vision extractor for PowerScribe worklist screenshots. It is isolated from OCR and Ollama so Browser Vision can be benchmarked honestly.

## Model

- Model ID: `onnx-community/Florence-2-base-ft`
- Task type: `image-text-to-text`
- Runtime: `@huggingface/transformers`
- Intended backend: WebGPU
- Explicit fallback: WebAssembly only when a caller opts in; Browser Vision does not silently fall back.
- Approximate download: about 900 MB to 1.5 GB depending on cached ONNX shards and dtype.
- Expected memory: practical WebGPU testing target is 4 GB or more available browser/GPU memory.
- Dtype strategy: fp16 for vision/embed components only when the WebGPU adapter supports `shader-f16`; otherwise fp32 for those components plus q4 encoder/decoder where supported.

The model repository is a Transformers.js-compatible ONNX conversion of Florence-2. The branch treats it as experimental because small text extraction from dense PowerScribe tables still needs real screenshot benchmarking.

## Privacy Boundary

The screenshot is processed locally in the browser. Browser Vision does not send the screenshot to Hugging Face hosted inference, OpenAI, Gemini, Supabase, Vercel functions, Ollama Cloud, or any external inference endpoint. Downloading public model files is allowed; inference runs locally after those files are cached by the browser/runtime.

## Flow

PowerScribe screenshot -> browser crop/preprocess -> Browser WebGPU Vision model -> structured row JSON -> `ImportedStudy[]` -> existing institution dictionary -> existing CPT/RVU matching -> duplicate detection -> review/save.

Browser Vision must only extract rows. It must not assign CPTs, RVUs, or duplicate status.

## Diagnostics

The Capture page reports:

- Engine: Browser Vision
- Model ID
- Backend
- Model load time
- Inference time
- Extracted row count
- Invalid/unresolved row count
- OCR used: No

If the visible worklist appears to contain more rows than Browser Vision extracted, the UI shows a possible missed-studies warning instead of claiming a clean success.
