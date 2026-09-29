import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Kawarp } from "../src/index";

type Rgb = [number, number, number];

const CORAL: Rgb = [220, 70, 60];
const BLUE: Rgb = [40, 60, 210];
const AMBER: Rgb = [230, 150, 40];
const DECODE_TOLERANCE = 10;

// Neutral settings so the rendered center pixel equals the source color
const COLOR_FAITHFUL = {
  saturation: 1,
  tintIntensity: 0,
  dithering: 0,
  warpIntensity: 0,
  transitionDuration: 0,
  style: { width: "64px", height: "64px" },
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

const solidImageUrl = (color: Rgb): string => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  context.fillStyle = `rgb(${color.join(",")})`;
  context.fillRect(0, 0, 32, 32);
  return canvas.toDataURL();
};

const createPlayingVideo = async (color: Rgb): Promise<HTMLVideoElement> => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  const paint = () => {
    context.fillStyle = `rgb(${color.join(",")})`;
    context.fillRect(0, 0, 320, 180);
  };
  paint();
  const timer = setInterval(paint, 16);
  const stream = canvas.captureStream(30);
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  cleanups.push(() => {
    clearInterval(timer);
    video.pause();
    for (const track of stream.getTracks()) track.stop();
  });
  return video;
};

const videoWithoutFrameCallbacks = (): HTMLVideoElement => {
  const video = document.createElement("video");
  Object.defineProperty(video, "requestVideoFrameCallback", {
    value: undefined,
  });
  return video;
};

const mount = () => {
  const container = document.createElement("div");
  container.style.width = "64px";
  container.style.height = "64px";
  document.body.append(container);
  const root: Root = createRoot(container);
  cleanups.push(() => act(() => root.unmount()));
  return { container, root };
};

const centerPixel = (container: HTMLElement): Rgb => {
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("canvas missing");
  const readback = document.createElement("canvas");
  readback.width = canvas.width;
  readback.height = canvas.height;
  const context = readback.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable");
  context.drawImage(canvas, 0, 0);
  const [red, green, blue] = context.getImageData(
    Math.floor(canvas.width / 2),
    Math.floor(canvas.height / 2),
    1,
    1,
  ).data;
  return [red ?? 0, green ?? 0, blue ?? 0];
};

const colorDistance = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

const waitForColor = async (
  container: HTMLElement,
  color: Rgb,
  tolerance: number,
) => {
  await vi.waitFor(
    () => {
      expect(colorDistance(centerPixel(container), color)).toBeLessThan(
        tolerance,
      );
    },
    { timeout: 3000, interval: 50 },
  );
};

describe("Kawarp video prop", () => {
  it("follows a video passed on mount", async () => {
    const video = await createPlayingVideo(CORAL);
    const { container, root } = mount();
    await act(async () => {
      root.render(<Kawarp {...COLOR_FAITHFUL} video={video} />);
    });
    await waitForColor(container, CORAL, DECODE_TOLERANCE);
  });

  it("goes back to src when the video is cleared", async () => {
    const video = await createPlayingVideo(CORAL);
    const src = solidImageUrl(BLUE);
    const { container, root } = mount();
    await act(async () => {
      root.render(<Kawarp {...COLOR_FAITHFUL} src={src} video={video} />);
    });
    await waitForColor(container, CORAL, DECODE_TOLERANCE);
    await act(async () => {
      root.render(<Kawarp {...COLOR_FAITHFUL} src={src} video={null} />);
    });
    await waitForColor(container, BLUE, 3);
  });

  it("loads the new src when a new video fails in the same render", async () => {
    const onError = vi.fn();
    const { container, root } = mount();
    await act(async () => {
      root.render(
        <Kawarp
          {...COLOR_FAITHFUL}
          src={solidImageUrl(BLUE)}
          onError={onError}
        />,
      );
    });
    await waitForColor(container, BLUE, 3);

    await act(async () => {
      root.render(
        <Kawarp
          {...COLOR_FAITHFUL}
          src={solidImageUrl(AMBER)}
          video={videoWithoutFrameCallbacks()}
          onError={onError}
        />,
      );
    });
    await waitForColor(container, AMBER, 3);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("loads src changes after the video has failed", async () => {
    const video = videoWithoutFrameCallbacks();
    const { container, root } = mount();
    await act(async () => {
      root.render(
        <Kawarp
          {...COLOR_FAITHFUL}
          src={solidImageUrl(BLUE)}
          video={video}
          onError={() => {}}
        />,
      );
    });
    await waitForColor(container, BLUE, 3);
    await act(async () => {
      root.render(
        <Kawarp
          {...COLOR_FAITHFUL}
          src={solidImageUrl(AMBER)}
          video={video}
          onError={() => {}}
        />,
      );
    });
    await waitForColor(container, AMBER, 3);
  });

  it("keeps following the video when src changes while it plays", async () => {
    const video = await createPlayingVideo(CORAL);
    const { container, root } = mount();
    await act(async () => {
      root.render(
        <Kawarp {...COLOR_FAITHFUL} src={solidImageUrl(BLUE)} video={video} />,
      );
    });
    await waitForColor(container, CORAL, DECODE_TOLERANCE);
    await act(async () => {
      root.render(
        <Kawarp {...COLOR_FAITHFUL} src={solidImageUrl(AMBER)} video={video} />,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(colorDistance(centerPixel(container), CORAL)).toBeLessThan(
      DECODE_TOLERANCE,
    );
  });
});
