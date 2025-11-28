"use client";

import { useState } from "react";
import { Logo } from "./Logo";
import Image from "next/image";
import { motion } from "motion/react";
import Link from "next/link";

interface HeaderProps {
  githubUrl: string;
}

export function Header({ githubUrl }: HeaderProps) {
  const [logoExpanded, setLogoExpanded] = useState(false);

  return (
    <header className="fixed w-full flex items-center justify-between bg-linear-to-b from-black/25 to-black/0 p-6 z-10">
      <div
        onMouseEnter={() => setLogoExpanded(true)}
        onMouseLeave={() => setLogoExpanded(false)}
      >
        <Logo expanded={logoExpanded} />
        <motion.span
          initial={{
            opacity: 0,
            y: -12,
            filter: "blur(4px)",
          }}
          animate={{
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
          }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="flex items-center gap-2 text-zinc-300 text-xs"
        >
          by
          <span className="flex items-center gap-1">
            <Image src="/favicon.svg" width={16} height={16} alt="logo" />
            <Link
              href="https://better-lyrics.boidu.dev"
              rel="noreferrer"
              target="_blank"
            >
              Better Lyrics
            </Link>
          </span>
        </motion.span>
      </div>
      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/20"
      >
        GitHub
      </a>
    </header>
  );
}
