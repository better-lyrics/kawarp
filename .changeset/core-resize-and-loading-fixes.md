---
"@kawarp/core": patch
---

Fix FBO viewport scaling on canvas resize and the initial black frame on first image load. Image loading is now more robust, using a CORS fetch with createImageBitmap and an `<img>` fallback.
