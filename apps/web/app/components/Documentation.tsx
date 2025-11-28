import { CodeBlock } from "./CodeBlock";
import { InstallTabs } from "./InstallTabs";

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
  return (
    <section className="relative z-10 border-t border-white/10 bg-zinc-950/90 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <h2 className="mb-12 text-3xl font-semibold tracking-tight text-white">
          Documentation
        </h2>

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
                  className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3"
                >
                  <code className="shrink-0 font-mono text-sm text-zinc-300">
                    {method.name}
                  </code>
                  <span className="text-sm text-zinc-500">{method.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-white/10 pt-12">
            <h2 className="mb-8 text-2xl font-semibold tracking-tight text-white">
              React
            </h2>

            <div className="space-y-12">
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
                  For imperative control, use the useKawarp hook to load images
                  dynamically without ref drilling.
                </p>
                <CodeBlock code={REACT_HOOK_CODE} />
              </div>

              <div>
                <h3 className="mb-4 text-lg font-medium text-white">
                  Component Props
                </h3>
                <p className="mb-4 text-sm text-zinc-400">
                  All core options are available as props, plus React-specific
                  ones:
                </p>
                <OptionsTable options={REACT_PROPS} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
