---
"@kawarp/core": patch
---

Video smoothing now eases toward the latest frame on every animation frame instead of only when a new video frame arrives, so low frame rate sources such as 24 fps artwork loops no longer step visibly on high refresh displays. Easing stops once the history settles on an unchanging frame.
