<img width="1920" height="1280" alt="kawarpbanner" src="https://github.com/user-attachments/assets/7420ee3d-ed6a-4e33-b1b4-8c5a46053215" />

# Kawarp

Fluid animated background renderer using WebGL, Kawase blur, and domain warping. Creates effects similar to Apple Music's album art visualization.

## Packages

- **[@kawarp/core](./packages/core)** - Pure TypeScript WebGL renderer
- **[@kawarp/react](./packages/react)** - React component wrapper

## Installation

```bash
npm install @kawarp/core
# or
npm install @kawarp/react
```

## Quick Start

### Vanilla JavaScript

```typescript
import { Kawarp } from '@kawarp/core';

const canvas = document.querySelector('canvas');
const kawarp = new Kawarp(canvas);

await kawarp.loadImage('path/to/image.jpg');
kawarp.start();
```

### React

```tsx
import { Kawarp } from '@kawarp/react';

function App() {
  return (
    <Kawarp
      src="/image.jpg"
      warpIntensity={0.8}
      style={{ width: '100%', height: '100vh' }}
    />
  );
}
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

## Methods

- `loadImage(url)` - Load image from URL
- `loadBlob(blob)` - Load from Blob or File
- `loadGradient(colors, angle?)` - Load gradient as source
- `start()` - Start animation
- `stop()` - Stop animation
- `resize()` - Update canvas dimensions
- `dispose()` - Clean up WebGL resources

## Development

```bash
pnpm install
pnpm dev
```

## Acknowledgements

The technique of combining Kawase blur on downscaled textures with domain warping for fluid distortion is based on [this article](https://portfolio.justzht.com/diffuse/) on [Diffuse](https://diffuse.app/) by Justin Zhang.

## License

AGPL-3.0
