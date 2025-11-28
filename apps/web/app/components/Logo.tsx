"use client";

import { motion } from "motion/react";

interface LogoProps {
  expanded: boolean;
}

export function Logo({ expanded }: LogoProps) {
  return (
    <motion.h1
      className="relative select-none text-xl font-medium text-white"
      layout
    >
      kawa
      <motion.span
        initial={false}
        animate={{
          width: expanded ? "auto" : 0,
          opacity: expanded ? 1 : 0,
        }}
        className="inline-block overflow-hidden whitespace-nowrap align-bottom font-light text-white/75"
      >
        se blur + domain wa
      </motion.span>
      rp
    </motion.h1>
  );
}
