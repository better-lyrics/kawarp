# Backend benchmark

Compares the WebGL2 and WebGPU backends on one machine.

```sh
pnpm --filter @kawarp/core build
npx serve packages/core
```

Open `/bench/` in Chrome, pick a backend and a video, and press Start. The overlay shows main-thread time per video frame and per render. Most of the cost is in the GPU process, so compare its CPU column in Chrome's task manager (Shift+Esc) between backends with the same video and window size.

WebGPU's `importExternalTexture` only avoids a copy when the browser decodes video on the GPU. Check `chrome://gpu` for "Video Decode: Hardware accelerated" before drawing conclusions about video.

## Results so far

Linux, RTX 4070 Laptop, Chromium 153 headless with ANGLE on Vulkan, software VP9 decode, 1280×720 canvas. GPU-process CPU:

| Source | WebGL2 | WebGPU |
|--------|--------|--------|
| Still image | 7% | 14–16% |
| 1080p60 video | 13–14% | 36–37% |
| 2160p30 video | 16% | 32–33% |

Frame rate held at 60 fps on both. Windows and macOS with hardware decode are not measured yet.
