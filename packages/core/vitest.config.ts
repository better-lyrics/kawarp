import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Canvas presentation for WebGPU on Linux needs Vulkan. SwiftShader for
// ANGLE, Vulkan, and WebGPU keeps rendering deterministic and works on
// GPU-less CI runners.
const WEBGPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-angle=swiftshader",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
];

declare module "vitest" {
  export interface ProvidedContext {
    backend: "webgl2" | "webgpu";
  }
}

// Every suite runs once per backend. The projects run one after the other:
// CPU rendering for both at once starves the video timing tests.
export default defineConfig({
  test: {
    projects: (["webgl2", "webgpu"] as const).map((backend, groupOrder) => ({
      test: {
        name: backend,
        include: ["test/**/*.test.ts"],
        provide: { backend },
        sequence: { groupOrder },
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({
            launchOptions: {
              args: backend === "webgpu" ? WEBGPU_ARGS : [],
            },
          }),
          instances: [{ browser: "chromium" as const, name: backend }],
        },
      },
    })),
  },
});
