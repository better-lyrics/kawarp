"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useRef } from "react";
import { PRESETS } from "../constants";

interface ControlPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  activePreset: number;
  onPresetSelect: (index: number) => void;
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
  onLoadFromUrl: () => void;
  onFileSelect: (file: File) => void;
  warpIntensity: number;
  onWarpIntensityChange: (value: number) => void;
  blurPasses: number;
  onBlurPassesChange: (value: number) => void;
  animationSpeed: number;
  onAnimationSpeedChange: (value: number) => void;
  transitionDuration: number;
  onTransitionDurationChange: (value: number) => void;
  saturation: number;
  onSaturationChange: (value: number) => void;
}

export function ControlPanel({
  isOpen,
  onToggle,
  onClose,
  activePreset,
  onPresetSelect,
  imageUrl,
  onImageUrlChange,
  onLoadFromUrl,
  onFileSelect,
  warpIntensity,
  onWarpIntensityChange,
  blurPasses,
  onBlurPassesChange,
  animationSpeed,
  onAnimationSpeedChange,
  transitionDuration,
  onTransitionDurationChange,
  saturation,
  onSaturationChange,
}: ControlPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="fixed inset-0 z-20"
            onClick={onClose}
          />
        )}
      </AnimatePresence>
      <div className="fixed right-6 top-1/2 z-30 flex -translate-y-1/2 items-center gap-3 md:right-8">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              key="panel"
              initial={{ opacity: 0, x: 8, scale: 0.85 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8, scale: 0.85 }}
              transition={{ duration: 0.15 }}
              className="w-72 rounded-2xl border border-white/5 bg-zinc-950/90 p-4 shadow-2xl backdrop-blur-md"
            >
              <div className="mb-5">
                <span className="mb-3 block text-xs text-zinc-500 font-semibold">
                  Presets
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {PRESETS.map((preset, i) => (
                    <motion.button
                      key={preset.name}
                      type="button"
                      onClick={() => onPresetSelect(i)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`relative aspect-square overflow-hidden rounded-lg border-2 ${
                        activePreset === i
                          ? "border-white"
                          : "border-transparent"
                      }`}
                      title={preset.name}
                    >
                      <Image
                        src={preset.url}
                        alt={preset.name}
                        fill
                        className="select-none object-cover"
                        draggable={false}
                      />
                    </motion.button>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/5 py-4">
                <span className="mb-4 block text-xs text-zinc-500 font-semibold">
                  Parameters
                </span>
                <div className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-zinc-200">Warp</span>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {warpIntensity?.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={warpIntensity}
                      onChange={(e) =>
                        onWarpIntensityChange(Number(e.target.value))
                      }
                      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-white"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-zinc-200">Blur</span>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {blurPasses}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="40"
                      step="1"
                      value={blurPasses}
                      onChange={(e) =>
                        onBlurPassesChange(Number(e.target.value))
                      }
                      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-white"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-zinc-200">Speed</span>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {animationSpeed.toFixed(1)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={animationSpeed}
                      onChange={(e) =>
                        onAnimationSpeedChange(Number(e.target.value))
                      }
                      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-white"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-zinc-200">Transition</span>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {(transitionDuration / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="3000"
                      step="100"
                      value={transitionDuration}
                      onChange={(e) =>
                        onTransitionDurationChange(Number(e.target.value))
                      }
                      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-white"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-zinc-200">Saturation</span>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {saturation.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.05"
                      value={saturation}
                      onChange={(e) =>
                        onSaturationChange(Number(e.target.value))
                      }
                      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-white"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-white/5 pt-4">
                <span className="mb-3 block text-xs text-zinc-500 font-semibold">
                  Custom image
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => onImageUrlChange(e.target.value)}
                    placeholder="Image URL..."
                    className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-white/20"
                    onKeyDown={(e) => e.key === "Enter" && onLoadFromUrl()}
                  />
                  <button
                    type="button"
                    onClick={onLoadFromUrl}
                    className="rounded-lg bg-white/10 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-white/20"
                  >
                    Go
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 rounded-lg border border-white/20 py-2 text-xs text-zinc-400 transition-colors hover:border-white/40 hover:text-zinc-200"
                  >
                    Upload
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onFileSelect(file);
                    }}
                  />
                  <div className="flex items-center justify-center rounded-lg border border-white/20 py-2 px-2 text-xs text-zinc-300 opacity-50">
                    ⌘V paste
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-full bg-white/10 p-3 text-white backdrop-blur-md transition-colors hover:bg-white/20"
        >
          <AnimatePresence mode="wait" initial={false}>
            {isOpen ? (
              <motion.svg
                key="close"
                initial={{ opacity: 0, scale: 0.75 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.75 }}
                transition={{ duration: 0.15 }}
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </motion.svg>
            ) : (
              <motion.svg
                key="open"
                initial={{ opacity: 0, scale: 0.75 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.75 }}
                transition={{ duration: 0.15 }}
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
                />
              </motion.svg>
            )}
          </AnimatePresence>
        </button>
      </div>
    </>
  );
}
