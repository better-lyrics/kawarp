// Size for blur operations (small = fast)
export const BLUR_SIZE = 128;

type Rgb = [number, number, number];

export const DEFAULTS = Object.freeze({
  warpIntensity: 1.0,
  blurPasses: 8,
  saturation: 1.5,
  tintColor: Object.freeze([0.157, 0.157, 0.235]) as Readonly<Rgb>,
  tintIntensity: 0.15,
  dithering: 0.008,
});

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const LIMITS = {
  warpIntensity: (value: number) => clamp(value, 0, 1),
  blurPasses: (value: number) => clamp(Math.floor(value), 0, 40),
  saturation: (value: number) => clamp(value, 0, 3),
  tintColor: (value: Readonly<Rgb>): Rgb => [
    clamp(value[0], 0, 1),
    clamp(value[1], 0, 1),
    clamp(value[2], 0, 1),
  ],
  tintIntensity: (value: number) => clamp(value, 0, 1),
  dithering: (value: number) => clamp(value, 0, 0.1),
};
