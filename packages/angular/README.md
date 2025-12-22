# @kawarp/angular

Angular component wrapper for Kawarp fluid animated backgrounds.

## Installation

```bash
npm install @kawarp/angular
```

## Usage

```typescript
import { KawarpComponent } from '@kawarp/angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [KawarpComponent],
  template: `
    <kawarp-background
      [src]="'/path/to/image.jpg'"
      [warpIntensity]="0.8"
      [blurPasses]="8"
      [animationSpeed]="1.0"
      style="width: 100%; height: 100vh;">
    </kawarp-background>
  `
})
export class AppComponent {}
```

## API

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `src` | `string` | - | Image URL to load |
| `warpIntensity` | `number` | `1.0` | Warp effect strength (0-1) |
| `blurPasses` | `number` | `8` | Kawase blur passes (1-40) |
| `animationSpeed` | `number` | `1.0` | Animation speed multiplier |
| `transitionDuration` | `number` | `1000` | Crossfade duration in ms |
| `saturation` | `number` | `1.5` | Color saturation multiplier |
| `tintColor` | `[number, number, number]` | `[0.16, 0.16, 0.24]` | Tint color for dark areas (0-1) |
| `tintIntensity` | `number` | `0.15` | Tint effect strength (0-1) |
| `dithering` | `number` | `0.008` | Dithering strength (0-0.1) |
| `scale` | `number` | `1.0` | Overall zoom level of the effect (0.01-4) |

## Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| `loadImage(url)` | `url: string` | Load image from URL |
| `loadBlob(blob)` | `blob: Blob` | Load from Blob or File |
| `loadGradient(colors, angle?)` | `colors: string[], angle?: number` | Load gradient as source |
| `start()` | - | Start animation |
| `stop()` | - | Stop animation |
| `resize()` | - | Update canvas dimensions |

## License

AGPL-3.0
