# @kawarp/react

React component for Kawarp fluid animated backgrounds. Built on the zero-dependency @kawarp/core.

## Installation

```bash
npm install @kawarp/react
```

## Usage

```jsx
import { Kawarp } from '@kawarp/react';

function App() {
  return (
    <Kawarp
      src="/album-art.jpg"
      style={{ width: '100%', height: '100vh' }}
    />
  );
}
```

## With Hook

For operations that can't be done via props (loading from files, blobs, or gradients), use the `useKawarp` hook:

```jsx
import { Kawarp, useKawarp } from '@kawarp/react';

function App() {
  const { ref, loadImage, loadBlob } = useKawarp();

  const handleFileUpload = async (file) => {
    await loadBlob(file);
  };

  return (
    <>
      <Kawarp ref={ref} src="/initial.jpg" style={{ width: '100%', height: '100vh' }} />
      <input type="file" onChange={(e) => handleFileUpload(e.target.files[0])} />
    </>
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | string | - | Image URL (auto-loads on change) |
| `autoPlay` | boolean | true | Auto-start animation |
| `onLoad` | function | - | Callback when image loads |
| `onError` | function | - | Callback on error |
| `className` | string | - | Container class name |
| `style` | CSSProperties | - | Container styles |
| `warpIntensity` | number | 1.0 | Warp effect strength (0-1) |
| `blurPasses` | number | 8 | Kawase blur passes (1-40) |
| `animationSpeed` | number | 1.0 | Animation speed multiplier |
| `transitionDuration` | number | 1000 | Crossfade duration in ms |
| `saturation` | number | 1.5 | Color saturation multiplier |
| `tintColor` | [r, g, b] | [0.16, 0.16, 0.24] | Tint color for dark areas (0-1) |
| `tintIntensity` | number | 0.15 | Tint effect strength (0-1) |
| `dithering` | number | 0.008 | Dithering strength (0-0.1) |
| `scale` | number | 1.0 | Overall zoom level of the effect (0.01-4) |

## License

AGPL-3.0

---

Built by [Better Lyrics](https://github.com/better-lyrics)
