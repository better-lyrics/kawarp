export type Rgb = [number, number, number];

export const createCanvas = (width = 64, height = 64): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  document.body.append(canvas);
  return canvas;
};

export const readCanvasPixels = (canvas: HTMLCanvasElement): ImageData => {
  const readback = document.createElement("canvas");
  readback.width = canvas.width;
  readback.height = canvas.height;
  const context = readback.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

export const pixelAt = (image: ImageData, x: number, y: number): Rgb => {
  const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
  ];
};

export const centerPixel = (canvas: HTMLCanvasElement): Rgb =>
  pixelAt(readCanvasPixels(canvas), canvas.width / 2, canvas.height / 2);

export const colorDistance = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

export const countDifferentBytes = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tolerance = 0,
): number => {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let differences = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > tolerance) differences++;
  }
  return differences;
};

export const createArtworkCanvas = (size = 256): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#1b1f3a");
  gradient.addColorStop(0.5, "#d9486b");
  gradient.addColorStop(1, "#f6c15b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#0a8f7a";
  context.beginPath();
  context.arc(size * 0.3, size * 0.7, size * 0.2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.fillRect(size * 0.6, size * 0.1, size * 0.25, size * 0.15);
  return canvas;
};

export const createSolidCanvas = (color: Rgb, size = 32): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  context.fillStyle = `rgb(${color.join(",")})`;
  context.fillRect(0, 0, size, size);
  return canvas;
};

export const createSplitCanvas = (top: Rgb, bottom: Rgb, size = 64) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  paintSplit(top, bottom)(context, size, size);
  return canvas;
};

export const createCheckerboardCanvas = (size = 256): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = (x + y) % 2 === 0 ? 255 : 0;
      image.data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

export type FramePainter = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => void;

export const paintSolid =
  (color: Rgb): FramePainter =>
  (context, width, height) => {
    context.fillStyle = `rgb(${color.join(",")})`;
    context.fillRect(0, 0, width, height);
  };

export const paintSplit =
  (top: Rgb, bottom: Rgb): FramePainter =>
  (context, width, height) => {
    context.fillStyle = `rgb(${top.join(",")})`;
    context.fillRect(0, 0, width, height / 2);
    context.fillStyle = `rgb(${bottom.join(",")})`;
    context.fillRect(0, height / 2, width, height / 2);
  };

export interface TestVideoSource {
  video: HTMLVideoElement;
  setPainter: (painter: FramePainter) => void;
  dispose: () => void;
}

/** A playing, decoder-backed video fed from a canvas stream */
export const createVideoSource = async (
  width: number,
  height: number,
  painter: FramePainter,
): Promise<TestVideoSource> => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  let currentPainter = painter;
  currentPainter(context, width, height);
  const paintTimer = setInterval(
    () => currentPainter(context, width, height),
    16,
  );

  const stream = canvas.captureStream(30);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await nextVideoFrames(video, 2);

  return {
    video,
    setPainter: (nextPainter) => {
      currentPainter = nextPainter;
    },
    dispose: () => {
      clearInterval(paintTimer);
      video.pause();
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
};

export const nextVideoFrames = async (
  video: HTMLVideoElement,
  count: number,
): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) =>
      video.requestVideoFrameCallback(() => resolve()),
    );
  }
};

export const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Wait until the new color has reached the video and one render has run */
export const settleVideo = async (video: HTMLVideoElement): Promise<void> => {
  await nextVideoFrames(video, 4);
  await nextAnimationFrame();
};

export const decodeHalfFloat = (bits: number): number => {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
};
