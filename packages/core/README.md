# @kawarp/core

Fluid animated background renderer using WebGL2 or WebGPU, Kawase blur, and domain warping. Creates effects similar to Apple Music's album art visualization. Zero dependencies.

## Installation

```bash
npm install @kawarp/core
```

## Usage

```javascript
import { Kawarp } from '@kawarp/core';

const canvas = document.querySelector('canvas');
const kawarp = new Kawarp(canvas);

await kawarp.loadImage('path/to/image.jpg');
kawarp.start();
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `warpIntensity` | number | 1.0 | Warp effect strength (0-1) |
| `blurPasses` | number | 8 | Kawase blur passes (0-40, 0 skips the blur) |
| `animationSpeed` | number | 1.0 | Animation speed multiplier (0-16) |
| `transitionDuration` | number | 1000 | Crossfade duration in ms |
| `saturation` | number | 1.5 | Color saturation multiplier |
| `tintColor` | [r, g, b] | [0.16, 0.16, 0.24] | Tint color for dark areas (0-1) |
| `tintIntensity` | number | 0.15 | Tint effect strength (0-1) |
| `dithering` | number | 0.008 | Peak-to-peak dither width (0-0.1); 0.008 is about one 8-bit step either way |
| `scale` | number | 1.0 | Overall zoom level of the effect (0.01-4) |

## Methods

- `loadImage(url)` - Load image from URL
- `loadBlob(blob)` - Load from Blob or File
- `loadGradient(colors, angle?)` - Load gradient as source
- `loadVideo(video, options?)` - Follow a playing video
- `unloadVideo()` - Stop following the video, keeping its last frame
- `sampleSource(size?)` - Read a small RGBA thumbnail of the current source
- `start()` - Start animation
- `stop()` - Stop animation
- `resize()` - Update canvas dimensions
- `dispose()` - Clean up GPU resources

## Video

Kawarp can use a playing `<video>` as its source. Every decoded frame is shrunk to a small color map on the GPU and blurred in place, so the background moves with the video. The first frame crossfades from whatever was on screen, or replaces it at once if the instance is stopped.

```javascript
const video = document.querySelector('video');

kawarp.loadVideo(video, { smoothing: 120 });
kawarp.start();

// Later: keep the last frame on screen and stop following the video
kawarp.unloadVideo();
```

Calling `loadVideo` again with the same element just updates the options. Loading an image replaces the video, except for an image load that was already in flight: it shows as a poster until the video's first frame arrives, and is dropped if that frame is already on screen. A stopped instance skips frames from a playing video, but it still redraws after you seek a paused one, so scrubbing works.

Video renders upright. Still images keep the vertically flipped orientation Kawarp has always drawn them in, which the blur mostly hides, so a poster of the same shot turns upside down as it crossfades into the video.

`loadVideo` needs `requestVideoFrameCallback` (Chrome 83, Firefox 132, Safari 15.4) and throws without it. The video must be same-origin or served with CORS headers.

| Video option | Type | Default | Description |
|--------|------|---------|-------------|
| `sampleWidth` | number | 128 | Width of the sampled color map (1-1024) |
| `sampleHeight` | number | 72 | Height of the sampled color map (1-1024) |
| `downsampleFactor` | number | 2 | Largest reduction per downsampling step (1.25-4) |
| `frameRate` | number | 0 | Frames sampled per second, 0 follows the video (0-240) |
| `smoothing` | number | 0 | Temporal color smoothing response in ms, 0 turns it off |
| `onError` | function | - | Called when a frame cannot be read; the video is unloaded first |

## Source Sampling

`sampleSource(size?)` resolves to a small RGBA thumbnail (`size` x `size`, 32 by default, bottom row of what's drawn first) of the current image or video frame. Use it for cheap measurements like brightness. The read goes through a pixel buffer and a fence, so it doesn't wait on the GPU.

```javascript
const pixels = await kawarp.sampleSource(16);
```

## Backends

`new Kawarp(canvas, options)` always renders with WebGL2. `Kawarp.create(canvas, options)` resolves to an instance on the API named by `backend`:

| `backend` | Behavior |
|-----------|----------|
| `"webgl2"` (default) | WebGL2 |
| `"webgpu"` | WebGPU, rejecting when it's unavailable |
| `"auto"` | WebGPU when available, otherwise WebGL2 |

```javascript
const kawarp = await Kawarp.create(canvas, { backend: "auto" });
console.log(kawarp.backend); // "webgpu" or "webgl2"
```

Both backends render the same image. WebGPU imports video frames with `importExternalTexture` instead of copying them, which should help when the browser decodes video on the GPU. On Linux with software decoding it costs more GPU-process CPU than WebGL2, so it stays opt-in until it's measured elsewhere; see [bench/README.md](bench/README.md).

WebGPU asks for the `"low-power"` adapter unless `powerPreference: "high-performance"` is passed. On hybrid laptops the display runs on the low-power GPU, and rendering on the other one means sharing every frame across GPUs: slower, and on Linux it can fail outright.

A canvas keeps the first context type it was given, so a canvas used by one backend can't be reused by the other.

## High Precision

Kawarp requires WebGL2 and renders through half-float targets where the GPU supports them. Two creation-only options raise precision further.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `highPrecisionInput` | boolean | false | Keep float32 color history for smoothed video |
| `highPrecisionOutput` | boolean | false | Request a float16 drawing buffer, falling back to 8-bit |

```javascript
const kawarp = new Kawarp(canvas, { highPrecisionInput: true });
```

`kawarp.highPrecisionInput` and `kawarp.highPrecisionOutput` tell you what the browser actually granted. A float16 drawing buffer cuts banding in dark gradients. It won't make anything brighter than SDR white.

## Dithering

The output is dithered with tileable blue noise, reshaped to a triangular distribution, with separate noise per color channel and a new pattern every drawn frame. Blue noise keeps the grain fine and even, so banding disappears at a lower visible noise level than white noise. The default `dithering` of 0.008 spans about one 8-bit step either way. On a float16 drawing buffer shown on a 10-bit display, roughly a quarter of that is enough.

## License

MIT

---

Built by [Better Lyrics](https://github.com/better-lyrics)
