"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { CodeBlock } from "./CodeBlock";
import { InstallTabs } from "./InstallTabs";

const TABS = [
  { id: "react" as const, label: "React" },
  { id: "angular" as const, label: "Angular" },
] as const;

const METHODS = [
  { name: "loadImage(url)", desc: "Load image from URL" },
  { name: "loadGradient(colors, angle?)", desc: "Load gradient as source" },
  { name: "loadBlob(blob)", desc: "Load from Blob or File" },
  { name: "start()", desc: "Start animation" },
  { name: "stop()", desc: "Stop animation" },
  { name: "resize()", desc: "Update dimensions" },
  { name: "dispose()", desc: "Clean up resources" },
];

const OPTIONS = [
  {
    name: "warpIntensity",
    type: "number",
    default: "1.0",
    desc: "Warp effect strength (0-1)",
  },
  {
    name: "blurPasses",
    type: "number",
    default: "8",
    desc: "Kawase blur passes (1-40)",
  },
  {
    name: "animationSpeed",
    type: "number",
    default: "1.0",
    desc: "Animation speed multiplier",
  },
  {
    name: "transitionDuration",
    type: "number",
    default: "1000",
    desc: "Crossfade duration in ms",
  },
  {
    name: "saturation",
    type: "number",
    default: "1.5",
    desc: "Color saturation multiplier",
  },
  {
    name: "tintColor",
    type: "[r, g, b]",
    default: "[0.16, 0.16, 0.24]",
    desc: "Tint color for dark areas (0-1)",
  },
  {
    name: "tintIntensity",
    type: "number",
    default: "0.15",
    desc: "Tint effect strength (0-1)",
  },
  {
    name: "dithering",
    type: "number",
    default: "0.008",
    desc: "Dithering strength (0-0.1)",
  },
  {
    name: "scale",
    type: "number",
    default: "1.0",
    desc: "Overall zoom level of the effect (0.01-4)",
  },
];

const QUICK_START_CODE = `import { Kawarp } from '@kawarp/core';

const canvas = document.querySelector('canvas');
const kawarp = new Kawarp(canvas);

await kawarp.loadImage('path/to/image.jpg');
kawarp.start();`;

const REACT_BASIC_CODE = `import { Kawarp } from '@kawarp/react';

function App() {
  return (
    <Kawarp
      src="/image.jpg"
      warpIntensity={0.8}
      style={{ width: '100%', height: '100vh' }}
    />
  );
}`;

const REACT_HOOK_CODE = `import { Kawarp, useKawarp } from '@kawarp/react';

function App() {
  const { ref, loadImage, loadBlob } = useKawarp();

  const handleUpload = async (file: File) => {
    await loadBlob(file);
  };

  return (
    <>
      <Kawarp ref={ref} src="/initial.jpg" />
      <button onClick={() => loadImage('/new.jpg')}>
        Load New Image
      </button>
    </>
  );
}`;

const REACT_PROPS = [
  { name: "src", type: "string", desc: "Image URL (auto-loads on change)" },
  {
    name: "autoPlay",
    type: "boolean",
    default: "true",
    desc: "Auto-start animation",
  },
  { name: "onLoad", type: "() => void", desc: "Called when image loads" },
  { name: "onError", type: "(error) => void", desc: "Called on load error" },
  { name: "className", type: "string", desc: "Container class name" },
  { name: "style", type: "CSSProperties", desc: "Container styles" },
];

const ANGULAR_BASIC_CODE = `import { KawarpComponent } from '@kawarp/angular';

@Component({
  imports: [KawarpComponent],
  template: \`
    <kawarp-background
      [src]="imageUrl"
      [warpIntensity]="0.8"
      style="width: 100%; height: 100vh"
    />
  \`
})
export class AppComponent {
  imageUrl = '/image.jpg';
}`;

const ANGULAR_IMPERATIVE_CODE = `import { KawarpComponent } from '@kawarp/angular';
import { viewChild } from '@angular/core';

@Component({
  imports: [KawarpComponent],
  template: \`
    <kawarp-background #kawarp [src]="imageUrl" />
    <button (click)="loadNew()">Load New Image</button>
  \`
})
export class AppComponent {
  private kawarp = viewChild<KawarpComponent>('kawarp');
  imageUrl = '/initial.jpg';

  async loadNew() {
    await this.kawarp()?.loadImage('/new.jpg');
  }
}`;

const ANGULAR_INPUTS = [
  { name: "src", type: "string", desc: "Image URL (auto-loads on change)" },
  {
    name: "autoPlay",
    type: "boolean",
    default: "true",
    desc: "Auto-start animation",
  },
  { name: "(loaded)", type: "EventEmitter", desc: "Emits when image loads" },
  { name: "(errored)", type: "EventEmitter", desc: "Emits on load error" },
];

function OptionsTable({
  options,
}: {
  options: Array<{
    name: string;
    type: string;
    default?: string;
    desc: string;
  }>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-white/5">
          <tr>
            <th className="px-4 py-3 font-medium text-zinc-300">Option</th>
            <th className="px-4 py-3 font-medium text-zinc-300">Type</th>
            <th className="px-4 py-3 font-medium text-zinc-300">Default</th>
            <th className="px-4 py-3 font-medium text-zinc-300">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {options.map((option) => (
            <tr key={option.name}>
              <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                {option.name}
              </td>
              <td className="px-4 py-3 text-zinc-500">{option.type}</td>
              <td className="px-4 py-3 text-zinc-500">
                {option.default ?? "-"}
              </td>
              <td className="px-4 py-3 text-zinc-400">{option.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Documentation() {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]["id"]>("react");

  return (
    <section className="relative z-10 border-t border-white/10 bg-zinc-950/90 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <h2 className="mb-6 text-3xl font-semibold tracking-tight text-white">
          Documentation
        </h2>

        <p className="mb-12 text-zinc-400 leading-relaxed">
          Kawarp is a zero-dependency, WebGL-powered library for creating fluid,
          animated background effects similar to Apple Music&apos;s album art
          visualization. It uses Kawase blur for efficient, high-quality
          blurring and simplex noise-based domain warping for organic motion.
          The library is optimized for performance with blur operations running
          on small textures only when the image changes, while per-frame
          rendering is minimal.
        </p>

        <div className="space-y-12">
          <div>
            <h3 className="mb-4 text-lg font-medium text-white">
              Installation
            </h3>
            <InstallTabs />
          </div>

          <div>
            <h3 className="mb-4 text-lg font-medium text-white">Quick Start</h3>
            <CodeBlock code={QUICK_START_CODE} />
          </div>

          <div>
            <h3 className="mb-4 text-lg font-medium text-white">Options</h3>
            <OptionsTable options={OPTIONS} />
          </div>

          <div>
            <h3 className="mb-4 text-lg font-medium text-white">Methods</h3>
            <div className="space-y-3">
              {METHODS.map((method) => (
                <div
                  key={method.name}
                  className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                  <code className="shrink-0 font-mono text-sm text-zinc-300">
                    {method.name}
                  </code>
                  <span className="text-sm text-zinc-500">{method.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 pt-12">
            <div className="mb-8 flex gap-6">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`text-2xl font-semibold tracking-tight transition-colors ${
                    activeTab === tab.id
                      ? "text-white"
                      : "text-zinc-600 hover:text-zinc-500"
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {activeTab === "react" ? (
                <motion.div
                  key="react"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="space-y-12">
                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      Installation
                    </h3>
                    <InstallTabs packageName="@kawarp/react" />
                  </div>

                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      Basic Usage
                    </h3>
                    <CodeBlock code={REACT_BASIC_CODE} />
                  </div>

                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      useKawarp Hook
                    </h3>
                    <p className="mb-4 text-sm text-zinc-400">
                      For operations that can&apos;t be done via props—like
                      loading from files, blobs, or gradients—use the useKawarp
                      hook.
                    </p>
                    <CodeBlock code={REACT_HOOK_CODE} />
                  </div>

                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      Component Props
                    </h3>
                    <p className="mb-4 text-sm text-zinc-400">
                      All core options are available as props, plus
                      React-specific ones:
                    </p>
                    <OptionsTable options={REACT_PROPS} />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="angular"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="space-y-12">
                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      Installation
                    </h3>
                    <InstallTabs packageName="@kawarp/angular" />
                  </div>

                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      Basic Usage
                    </h3>
                    <CodeBlock code={ANGULAR_BASIC_CODE} />
                  </div>

                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      Imperative API
                    </h3>
                    <p className="mb-4 text-sm text-zinc-400">
                      For operations that can&apos;t be done via inputs—like
                      loading from files, blobs, or gradients—use the component
                      instance methods.
                    </p>
                    <CodeBlock code={ANGULAR_IMPERATIVE_CODE} />
                  </div>

                  <div>
                    <h3 className="mb-4 text-lg font-medium text-white">
                      Component Inputs
                    </h3>
                    <p className="mb-4 text-sm text-zinc-400">
                      All core options are available as inputs, plus
                      Angular-specific ones:
                    </p>
                    <OptionsTable options={ANGULAR_INPUTS} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
