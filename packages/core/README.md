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
| `blurPasses` | number | 8 | Kawase blur passes (1-40) |
| `animationSpeed` | number | 1.0 | Animation speed multiplier |
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
- `start()` - Start animation
- `stop()` - Stop animation
- `resize()` - Update canvas dimensions
- `dispose()` - Clean up WebGL resources

## License

AGPL-3.0

---

Built by [Better Lyrics](https://github.com/better-lyrics)
