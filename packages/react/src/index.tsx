import { Kawarp as KawarpCore, type KawarpOptions } from "@kawarp/core";
import {
  type CSSProperties,
  forwardRef,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

export type { KawarpOptions } from "@kawarp/core";

export interface KawarpRef {
  /** The underlying Kawarp instance */
  instance: KawarpCore | null;
  /** Load an image from a URL */
  loadImage: (src: string) => Promise<void>;
  /** Load from a Blob or File */
  loadBlob: (blob: Blob) => Promise<void>;
  /** Load colors as a gradient source */
  loadGradient: (colors: string[], angle?: number) => void;
  /** Start the animation */
  start: () => void;
  /** Stop the animation */
  stop: () => void;
}

export interface KawarpProps extends KawarpOptions {
  /** Additional class name for the canvas */
  className?: string;
  /** Additional styles for the canvas */
  style?: CSSProperties;
  /** Image URL to load (auto-loads when changed) */
  src?: string;
  /** Whether to auto-start animation (default: true) */
  autoPlay?: boolean;
  /** Callback when the image is loaded */
  onLoad?: () => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
}

export interface UseKawarpReturn {
  /** Ref to pass to the Kawarp component */
  ref: RefObject<KawarpRef | null>;
  /** Load an image from a URL */
  loadImage: (src: string) => Promise<void>;
  /** Load from a Blob or File */
  loadBlob: (blob: Blob) => Promise<void>;
  /** Load colors as a gradient source */
  loadGradient: (colors: string[], angle?: number) => void;
  /** Start the animation */
  start: () => void;
  /** Stop the animation */
  stop: () => void;
}

/**
 * Hook to control a Kawarp component imperatively
 *
 * @example
 * ```tsx
 * const { ref, loadImage, loadBlob } = useKawarp();
 *
 * // Load images without ref.current?.
 * await loadImage('https://example.com/image.jpg');
 * await loadBlob(file);
 *
 * <Kawarp ref={ref} src={initialSrc} />
 * ```
 */
export function useKawarp(): UseKawarpReturn {
  const ref = useRef<KawarpRef | null>(null);

  const loadImage = useCallback(async (src: string) => {
    await ref.current?.loadImage(src);
  }, []);

  const loadBlob = useCallback(async (blob: Blob) => {
    await ref.current?.loadBlob(blob);
  }, []);

  const loadGradient = useCallback((colors: string[], angle?: number) => {
    ref.current?.loadGradient(colors, angle);
  }, []);

  const start = useCallback(() => {
    ref.current?.start();
  }, []);

  const stop = useCallback(() => {
    ref.current?.stop();
  }, []);

  return { ref, loadImage, loadBlob, loadGradient, start, stop };
}

export const Kawarp = forwardRef<KawarpRef, KawarpProps>(function Kawarp(
  {
    className,
    style,
    src,
    autoPlay = true,
    onLoad,
    onError,
    warpIntensity,
    blurPasses,
    animationSpeed,
    transitionDuration,
    saturation,
    tintColor,
    tintIntensity,
    dithering,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kawarpRef = useRef<KawarpCore | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const currentSrcRef = useRef<string | undefined>(undefined);

  // Expose imperative methods
  useImperativeHandle(
    ref,
    () => ({
      get instance() {
        return kawarpRef.current;
      },
      loadImage: async (url: string) => {
        await kawarpRef.current?.loadImage(url);
      },
      loadBlob: async (blob: Blob) => {
        await kawarpRef.current?.loadBlob(blob);
      },
      loadGradient: (colors: string[], angle?: number) => {
        kawarpRef.current?.loadGradient(colors, angle);
      },
      start: () => {
        kawarpRef.current?.start();
      },
      stop: () => {
        kawarpRef.current?.stop();
      },
    }),
    [],
  );

  // Initialize Kawarp
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const kawarp = new KawarpCore(canvas, {
      warpIntensity,
      blurPasses,
      animationSpeed,
      transitionDuration,
      saturation,
      tintColor,
      tintIntensity,
      dithering,
    });
    kawarpRef.current = kawarp;
    initializedRef.current = true;

    // Load initial image if provided
    if (src) {
      currentSrcRef.current = src;
      kawarp
        .loadImage(src)
        .then(() => {
          onLoad?.();
          if (autoPlay) kawarp.start();
        })
        .catch((error) => {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        });
    } else if (autoPlay) {
      kawarp.start();
    }

    return () => {
      kawarp.dispose();
      kawarpRef.current = null;
      initializedRef.current = false;
    };
    // Only run on mount/unmount - options and src are updated separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load when src prop changes
  useEffect(() => {
    if (!initializedRef.current || !kawarpRef.current) return;
    if (src === currentSrcRef.current) return;

    currentSrcRef.current = src;
    if (src) {
      kawarpRef.current
        .loadImage(src)
        .then(() => onLoad?.())
        .catch((error) => {
          onError?.(error instanceof Error ? error : new Error(String(error)));
        });
    }
  }, [src, onLoad, onError]);

  // Memoize tintColor to prevent unnecessary updates
  const stableTintColor = useMemo(
    () => tintColor,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tintColor?.[0], tintColor?.[1], tintColor?.[2]],
  );

  // Update options when props change
  useEffect(() => {
    kawarpRef.current?.setOptions({
      warpIntensity,
      blurPasses,
      animationSpeed,
      transitionDuration,
      saturation,
      tintColor: stableTintColor,
      tintIntensity,
      dithering,
    });
  }, [
    warpIntensity,
    blurPasses,
    animationSpeed,
    transitionDuration,
    saturation,
    stableTintColor,
    tintIntensity,
    dithering,
  ]);

  // Handle resize with ResizeObserver (debounced, with devicePixelRatio)
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
      kawarpRef.current?.resize();
    };

    const debouncedUpdateSize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateSize, 100);
    };

    const resizeObserver = new ResizeObserver(debouncedUpdateSize);
    resizeObserver.observe(container);
    updateSize();

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", ...style }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
});

export default Kawarp;
