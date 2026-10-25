import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// WebGPU on Linux needs ANGLE on Vulkan for canvas presentation. SwiftShader
// keeps it deterministic and available on GPU-less CI runners.
const GPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
  "--use-angle=vulkan",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
];

declare module "vitest" {
  export interface ProvidedContext {
    backend: "webgl2" | "webgpu";
  }
}

// Every suite runs once per backend
export default defineConfig({
  test: {
    projects: (["webgl2", "webgpu"] as const).map((backend) => ({
      test: {
        name: backend,
        include: ["test/**/*.test.ts"],
        provide: { backend },
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({ launchOptions: { args: GPU_ARGS } }),
          instances: [{ browser: "chromium" as const, name: backend }],
        },
      },
    })),
  },
});
