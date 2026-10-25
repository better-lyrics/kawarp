import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// WebGPU on Linux needs ANGLE on Vulkan for canvas presentation. SwiftShader
// keeps it deterministic and available on GPU-less CI runners.
const WEBGPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
  "--use-angle=vulkan",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
];

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { args: WEBGPU_ARGS } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
