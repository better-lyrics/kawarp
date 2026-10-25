---
"@kawarp/core": major
"@kawarp/react": major
"@kawarp/angular": major
---

Kawarp now requires WebGL2. The WebGL1 pipeline is gone, so every instance renders through half-float targets where the GPU supports them, and `highPrecisionInput` and `highPrecisionOutput` no longer select the context; they only add float32 video history and a float16 drawing buffer. Output dithering now uses tileable blue noise reshaped to a triangular distribution, with separate noise per color channel and a new pattern every drawn frame instead of every 1/60 s. `dithering` keeps its range and default, still measured as the peak-to-peak width. Video frames are flipped upright in the first downsample pass instead of with `UNPACK_FLIP_Y_WEBGL`, which can keep browsers on their fast video upload path.
