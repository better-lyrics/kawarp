---
"@kawarp/core": minor
"@kawarp/react": minor
---

Add video sources: `loadVideo` follows a playing `<video>`, sampling each decoded frame on the GPU, and `unloadVideo` stops following it while keeping the last frame. `sampleSource` reads a small thumbnail of the current source for brightness checks. The creation-only `highPrecisionInput` and `highPrecisionOutput` options opt into WebGL2 float render targets and a float16 drawing buffer. `blurPasses` now accepts 0 and `animationSpeed` accepts 0 to 16; values that were already in range behave as before. The React component gains `video`, `videoOptions`, `highPrecisionInput`, and `highPrecisionOutput` props.
