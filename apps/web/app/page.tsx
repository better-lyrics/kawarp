"use client";

import { Kawarp } from "@kawarp/react";
import { AnimatePresence, motion } from "motion/react";
import { ControlPanel, Documentation, Footer, Header } from "./components";
import { PRESETS } from "./constants";
import { useKawarpDemo } from "./hooks/useKawarpDemo";

const GITHUB_URL = "https://github.com/better-lyrics/kawarp";

export default function Home() {
  const {
    ref,
    state,
    updateState,
    loadPreset,
    loadFromUrl,
    handleFile,
    handleDrop,
  } = useKawarpDemo();

  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        updateState("isDragging", true);
      }}
      onDragLeave={() => updateState("isDragging", false)}
      onDrop={handleDrop}
    >
      <motion.div
        className="fixed inset-0 -z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: state.isLoaded ? 1 : 0 }}
        transition={{ duration: 0.5 }}
      >
        <Kawarp
          ref={ref}
          src={PRESETS[0].url}
          warpIntensity={state.warpIntensity}
          blurPasses={state.blurPasses}
          animationSpeed={state.animationSpeed}
          transitionDuration={state.transitionDuration}
          saturation={state.saturation}
          onLoad={() => updateState("isLoaded", true)}
          style={{ width: "100%", height: "100%" }}
        />
      </motion.div>

      <AnimatePresence>
        {state.isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="rounded-2xl border-2 border-dashed border-zinc-500 px-16 py-12"
            >
              <p className="text-xl text-zinc-300">Drop image here</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 flex flex-col">
        <Header githubUrl={GITHUB_URL} />

        <ControlPanel
          isOpen={state.panelOpen}
          onToggle={() => updateState("panelOpen", !state.panelOpen)}
          onClose={() => updateState("panelOpen", false)}
          activePreset={state.activePreset}
          onPresetSelect={loadPreset}
          imageUrl={state.imageUrl}
          onImageUrlChange={(url) => updateState("imageUrl", url)}
          onLoadFromUrl={loadFromUrl}
          onFileSelect={handleFile}
          warpIntensity={state.warpIntensity}
          onWarpIntensityChange={(v) => updateState("warpIntensity", v)}
          blurPasses={state.blurPasses}
          onBlurPassesChange={(v) => updateState("blurPasses", v)}
          animationSpeed={state.animationSpeed}
          onAnimationSpeedChange={(v) => updateState("animationSpeed", v)}
          transitionDuration={state.transitionDuration}
          onTransitionDurationChange={(v) => updateState("transitionDuration", v)}
          saturation={state.saturation}
          onSaturationChange={(v) => updateState("saturation", v)}
        />

        <main className="relative flex min-h-[85vh] items-end justify-start p-6">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.3 }}
            className="max-w-xs text-sm text-white/40"
          >
            Fluid animated backgrounds powered by WebGL, Kawase blur & domain
            warping.
          </motion.p>
          <div className="-z-1 absolute bottom-0 left-0 h-48 w-full bg-linear-to-t from-black/30 to-black/0" />
        </main>

        <Documentation />
        <Footer />
      </div>
    </div>
  );
}
