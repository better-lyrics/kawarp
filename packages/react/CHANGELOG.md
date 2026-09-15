# @kawarp/react

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
