# @kawarp/react

## 1.3.1

### Patch Changes

- Updated dependencies [326e81c]
  - @kawarp/core@1.3.1

## 1.3.0

### Minor Changes

- 22a748e: Add video sources: `loadVideo` follows a playing `<video>`, sampling each decoded frame on the GPU, and `unloadVideo` stops following it while keeping the last frame. `sampleSource` reads a small thumbnail of the current source for brightness checks. The creation-only `highPrecisionInput` and `highPrecisionOutput` options opt into WebGL2, for float32 smoothing history and a float16 drawing buffer. `blurPasses` now accepts 0 and `animationSpeed` accepts 0 to 16; values that were already in range behave as before. A crossfade no longer draws a black frame when `transitionDuration` is 0, and a source that arrives after the current frame's timestamp starts its crossfade from the old image instead of partway in. The React component gains `video`, `videoOptions`, `highPrecisionInput`, and `highPrecisionOutput` props.

### Patch Changes

- Updated dependencies [22a748e]
  - @kawarp/core@1.3.0

## 1.2.2

### Patch Changes

- 5638962: Fix garbled output under React StrictMode and repeated mounts. A disposed Kawarp instance is now inert: it no longer touches its WebGL context or starts a render loop after an in-flight image load resolves, so a remount on the same canvas cannot desync the crossfade buffers. The React wrapper also skips `onLoad`/`onError`/auto-start for a mount that has already been torn down.
- Updated dependencies [5638962]
  - @kawarp/core@1.2.2

## 1.2.1

### Patch Changes

- Updated dependencies [561a1f6]
  - @kawarp/core@1.2.1

## 1.2.0

### Minor Changes

- 8a9a339: Relicense from AGPL-3.0 to MIT.

### Patch Changes

- Updated dependencies [8a9a339]
  - @kawarp/core@1.2.0

## 1.1.1

### Patch Changes

- 4a06e77: feat: add scale prop
- Updated dependencies [4a06e77]
  - @kawarp/core@1.1.1

## 1.1.0

### Minor Changes

- 0938343: fix: ease/lerp between animationspeed changes

### Patch Changes

- Updated dependencies [0938343]
  - @kawarp/core@1.1.0

## 1.0.2

### Patch Changes

- 8ca72d0: fix: highp instead of mediump for shaders
- Updated dependencies [8ca72d0]
  - @kawarp/core@1.0.2

## 1.0.1

### Patch Changes

- acba3c6: chore: readme updates & docs
- Updated dependencies [acba3c6]
  - @kawarp/core@1.0.1

## 1.0.0

### Major Changes

- 73d9c7f: feat: dithering, perfomance optimization, tint

### Patch Changes

- Updated dependencies [73d9c7f]
  - @kawarp/core@1.0.0

## 0.1.1

### Patch Changes

- 03d3616: chore: added readme
- Updated dependencies [03d3616]
  - @kawarp/core@0.1.1
