"use client";

import { motion } from "motion/react";
import { useState } from "react";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copyToClipboard}
      className={`rounded-lg p-1.5 text-zinc-500 transition-all hover:bg-white/10 hover:text-zinc-300 ${className}`}
    >
      <motion.svg
        key={copied ? "check" : "copy"}
        initial={{ scale: 0.8, opacity: 0, y: 2 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className={`h-4 w-4 ${copied ? "text-emerald-400" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        {copied ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        )}
      </motion.svg>
    </button>
  );
}
