---
"@kawarp/core": patch
"@kawarp/react": patch
---

Fix garbled output under React StrictMode and repeated mounts. A disposed Kawarp instance is now inert: it no longer touches its WebGL context or starts a render loop after an in-flight image load resolves, so a remount on the same canvas cannot desync the crossfade buffers. The React wrapper also skips `onLoad`/`onError`/auto-start for a mount that has already been torn down.
