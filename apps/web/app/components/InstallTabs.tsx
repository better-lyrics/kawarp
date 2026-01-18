"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { PACKAGE_MANAGERS } from "../constants";
import { CopyButton } from "./CopyButton";

interface InstallTabsProps {
  packageName?: string;
}

export function InstallTabs({
  packageName = "@kawarp/core",
}: InstallTabsProps) {
  const [selected, setSelected] = useState<string>("npm");

  const selectedPm = PACKAGE_MANAGERS.find((pm) => pm.id === selected);
  const fullCommand = `${selectedPm?.cmd} ${packageName}`;

  return (
    <div>
      <div className="mb-3 flex gap-1">
        {PACKAGE_MANAGERS.map((pm) => (
          <button
            key={pm.id}
            type="button"
            onClick={() => setSelected(pm.id)}
            className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              selected === pm.id
                ? "text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {selected === pm.id && (
              <motion.div
                layoutId={`${packageName}-install-tab-indicator`}
                className="absolute inset-0 rounded-lg bg-white/10"
                transition={{ duration: 0.2 }}
              />
            )}
            <span className="relative z-10">{pm.label}</span>
          </button>
        ))}
      </div>
      <div className="group relative">
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-900/80 p-4 pr-12 text-sm">
          <code className="flex text-zinc-300">
            <span className="text-zinc-500">$</span>&nbsp;
            {selectedPm?.cmd.split(" ").map((word, i, arr) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: layout anims work better this way
              <span key={i} className="flex">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={word}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: "anticipate" }}
                  >
                    {word}
                  </motion.span>
                </AnimatePresence>
                {i < arr.length - 1 && <span>&nbsp;</span>}
              </span>
            ))}
            <motion.span
              layout
              className="text-emerald-400"
              transition={{ duration: 0.2, ease: "anticipate" }}
            >
              &nbsp;{packageName}
            </motion.span>
          </code>
        </pre>
        <CopyButton
          text={fullCommand}
          className="absolute right-3 top-1/2 -translate-y-1/2 md:opacity-0 md:group-hover:opacity-100"
        />
      </div>
    </div>
  );
}
