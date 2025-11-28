"use client";

import { useKawarp } from "@kawarp/react";
import { useCallback, useEffect, useState } from "react";
import { PRESETS } from "../constants";

export interface KawarpDemoState {
  isLoaded: boolean;
  activePreset: number;
  imageUrl: string;
  warpIntensity: number;
  blurPasses: number;
  animationSpeed: number;
  transitionDuration: number;
  saturation: number;
  isDragging: boolean;
  panelOpen: boolean;
}

export function useKawarpDemo() {
  const { ref, loadImage, loadBlob } = useKawarp();

  const [state, setState] = useState<KawarpDemoState>({
    isLoaded: false,
    activePreset: 0,
    imageUrl: "",
    warpIntensity: 1.0,
    blurPasses: 8,
    animationSpeed: 1.0,
    transitionDuration: 1000,
    saturation: 1.5,
    isDragging: false,
    panelOpen: false,
  });

  const updateState = useCallback(
    <K extends keyof KawarpDemoState>(key: K, value: KawarpDemoState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const loadPreset = useCallback(
    async (index: number) => {
      const preset = PRESETS[index];
      if (!preset) return;
      try {
        await loadImage(preset.url);
        updateState("activePreset", index);
      } catch {
        /* ignore */
      }
    },
    [loadImage, updateState],
  );

  const loadFromUrl = useCallback(async () => {
    if (!state.imageUrl.trim()) return;
    try {
      await loadImage(state.imageUrl);
      updateState("activePreset", -1);
    } catch {
      alert("Failed to load image. Check the URL and try again.");
    }
  }, [loadImage, state.imageUrl, updateState]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      try {
        await loadBlob(file);
        updateState("activePreset", -1);
      } catch {
        alert("Failed to load image.");
      }
    },
    [loadBlob, updateState],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      updateState("isDragging", false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile, updateState],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) handleFile(file);
          break;
        }
      }
    },
    [handleFile],
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return {
    ref,
    state,
    updateState,
    loadPreset,
    loadFromUrl,
    handleFile,
    handleDrop,
  };
}
