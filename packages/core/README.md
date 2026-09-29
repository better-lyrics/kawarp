# @kawarp/core

Fluid animated background renderer using WebGL, Kawase blur, and domain warping. Creates effects similar to Apple Music's album art visualization. Zero dependencies.

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
| `dithering` | number | 0.008 | Dithering strength (0-0.1) |
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
- `dispose()` - Clean up WebGL resources

## Video

Kawarp can use a playing `<video>` as its source. Every decoded frame is shrunk to a small color map on the GPU and blurred in place, so the background moves with the video. The first frame crossfades from whatever was on screen.

```javascript
const video = document.querySelector('video');

kawarp.loadVideo(video, { smoothing: 120 });
kawarp.start();

// Later: keep the last frame on screen and stop following the video
kawarp.unloadVideo();
```

Calling `loadVideo` again with the same element just updates the options. Loading an image replaces the video. A stopped instance skips frames from a playing video, but it still redraws after you seek a paused one, so scrubbing works.

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

`sampleSource(size?)` resolves to a small RGBA thumbnail (`size` x `size`, 32 by default, rows bottom to top) of the current image or video frame. Use it for cheap measurements like brightness. On WebGL2 the read goes through a pixel buffer and a fence, so it doesn't wait on the GPU. On WebGL1 it's a synchronous read of a few kilobytes.

```javascript
const pixels = await kawarp.sampleSource(16);
```

## High Precision

Two creation-only options opt into WebGL2. Without them Kawarp uses the same WebGL1 pipeline as before.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `highPrecisionInput` | boolean | false | Use float render targets for video sampling and blur |
| `highPrecisionOutput` | boolean | false | Request a float16 drawing buffer, falling back to 8-bit |

```javascript
const kawarp = new Kawarp(canvas, { highPrecisionInput: true });
```

`kawarp.highPrecisionInput` and `kawarp.highPrecisionOutput` tell you what the browser actually granted. A float16 drawing buffer cuts banding in dark gradients. It won't make anything brighter than SDR white.

## License

MIT

---

Built by [Better Lyrics](https://github.com/better-lyrics)
