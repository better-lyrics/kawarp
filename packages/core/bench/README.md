# Backend benchmark

Compares the WebGL2 and WebGPU backends on one machine.

```sh
pnpm --filter @kawarp/core build
npx serve packages/core
```

Open `/bench/` in Chrome, pick a backend and a video, and press Start. The overlay shows main-thread time per video frame and per render. Most of the cost is in the GPU process, so compare its CPU column in Chrome's task manager (Shift+Esc) between backends with the same video and window size.

WebGPU's `importExternalTexture` only avoids a copy when the browser decodes video on the GPU. Check `chrome://gpu` for "Video Decode: Hardware accelerated" before drawing conclusions about video.

## Results so far

Linux laptop (Intel Arc + RTX 4070), Google Chrome 156 on Wayland compositing on the Intel GPU with Vulkan on, 240 Hz display, software VP9 decode, 1280×720 canvas. GPU-process CPU:

| Source | WebGL2 | WebGPU, low-power | WebGPU, high-performance |
|--------|--------|-------------------|--------------------------|
| Still image | 20% | 22% | 22% |
| 1080p60 video | 22–24% | 34–37% | 40–49% |

`high-performance` puts WebGPU on the NVIDIA GPU while Chrome composites on Intel. Canvas frames then fail to import across GPUs and the console fills with invalid texture errors, which is why WebGPU defaults to `low-power`. Hardware decode, and Windows and macOS, are not measured yet.
