---
"@kawarp/core": minor
"@kawarp/react": minor
---

Add an optional WebGPU backend. `Kawarp.create(canvas, { backend })` resolves to an instance on `"webgl2"` (the default), `"webgpu"`, or `"auto"`, which prefers WebGPU and falls back to WebGL2; `kawarp.backend` reports the result. Both backends render the same image, and WebGPU imports video frames with `importExternalTexture` instead of copying them. The constructor still always uses WebGL2. WebGPU uses the low-power adapter unless `powerPreference: "high-performance"` is passed. Video smoothing no longer treats a live `MediaStream` source as seeking when its frames arrive late.
