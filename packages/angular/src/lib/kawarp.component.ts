import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from "@angular/core";
import { Kawarp, type KawarpOptions } from "@kawarp/core";

export type { KawarpOptions } from "@kawarp/core";

@Component({
  selector: "kawarp-background",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #container class="kawarp-container"><canvas #canvas></canvas></div>`,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .kawarp-container { position: relative; width: 100%; height: 100%; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  `,
})
export class KawarpComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>("canvas");
  private readonly containerRef = viewChild.required<ElementRef<HTMLDivElement>>("container");

  // Signal inputs
  readonly src = input<string>();
  readonly autoPlay = input(true);
  readonly warpIntensity = input<number>();
  readonly blurPasses = input<number>();
  readonly animationSpeed = input<number>();
  readonly transitionDuration = input<number>();
  readonly saturation = input<number>();
  readonly tintColor = input<[number, number, number]>();
  readonly tintIntensity = input<number>();
  readonly dithering = input<number>();
  readonly scale = input<number>();

  // Signal outputs
  readonly loaded = output<void>();
  readonly errored = output<Error>();

  // Internal state
  private kawarp: Kawarp | null = null;
  private currentSrc?: string;

  /** The underlying Kawarp instance */
  get instance(): Kawarp | null {
    return this.kawarp;
  }

  // Computed options from inputs
  private readonly options = computed<KawarpOptions>(() => ({
    ...(this.warpIntensity() !== undefined && { warpIntensity: this.warpIntensity() }),
    ...(this.blurPasses() !== undefined && { blurPasses: this.blurPasses() }),
    ...(this.animationSpeed() !== undefined && { animationSpeed: this.animationSpeed() }),
    ...(this.transitionDuration() !== undefined && { transitionDuration: this.transitionDuration() }),
    ...(this.saturation() !== undefined && { saturation: this.saturation() }),
    ...(this.tintColor() !== undefined && { tintColor: this.tintColor() }),
    ...(this.tintIntensity() !== undefined && { tintIntensity: this.tintIntensity() }),
    ...(this.dithering() !== undefined && { dithering: this.dithering() }),
    ...(this.scale() !== undefined && { scale: this.scale() }),
  }));

  constructor() {
    afterNextRender(() => this.initialize());

    effect(() => {
      const opts = this.options();
      this.kawarp?.setOptions(opts);
    });

    effect(() => {
      const src = this.src();
      if (src && src !== this.currentSrc && this.kawarp) {
        this.currentSrc = src;
        this.kawarp.loadImage(src)
          .then(() => this.loaded.emit())
          .catch((e) => this.errored.emit(e instanceof Error ? e : new Error(String(e))));
      }
    });
  }

  private initialize(): void {
    const canvas = this.canvasRef().nativeElement;
    const container = this.containerRef().nativeElement;

    this.kawarp = new Kawarp(canvas, this.options());
    this.setupResizeObserver(container, canvas);

    const src = this.src();
    if (src) {
      this.currentSrc = src;
      this.kawarp.loadImage(src)
        .then(() => {
          this.loaded.emit();
          if (this.autoPlay()) this.kawarp?.start();
        })
        .catch((e) => this.errored.emit(e instanceof Error ? e : new Error(String(e))));
    } else if (this.autoPlay()) {
      this.kawarp.start();
    }

    this.destroyRef.onDestroy(() => {
      this.kawarp?.dispose();
      this.kawarp = null;
    });
  }

  private setupResizeObserver(container: HTMLElement, canvas: HTMLCanvasElement): void {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const updateSize = () => {
      const { width, height } = container.getBoundingClientRect();
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      this.kawarp?.resize();
    };

    const observer = new ResizeObserver(() => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(updateSize, 100);
    });

    observer.observe(container);
    updateSize();

    this.destroyRef.onDestroy(() => {
      observer.disconnect();
      if (timeout) clearTimeout(timeout);
    });
  }

  // Public API
  loadImage = async (url: string): Promise<void> => {
    if (!this.kawarp) return;
    await this.kawarp.loadImage(url);
    this.loaded.emit();
  };

  loadBlob = async (blob: Blob): Promise<void> => {
    if (!this.kawarp) return;
    await this.kawarp.loadBlob(blob);
    this.loaded.emit();
  };

  loadGradient = (colors: string[], angle?: number): void => {
    this.kawarp?.loadGradient(colors, angle);
  };

  start = (): void => this.kawarp?.start();
  stop = (): void => this.kawarp?.stop();
  resize = (): void => this.kawarp?.resize();
}
