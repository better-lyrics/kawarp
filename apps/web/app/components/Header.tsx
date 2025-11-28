"use client";

import { useState } from "react";
import { Logo } from "./Logo";

interface HeaderProps {
  githubUrl: string;
}

export function Header({ githubUrl }: HeaderProps) {
  const [logoExpanded, setLogoExpanded] = useState(false);

  return (
    <header className="flex items-center justify-between bg-linear-to-b from-black/25 to-black/0 p-6">
      <div
        onMouseEnter={() => setLogoExpanded(true)}
        onMouseLeave={() => setLogoExpanded(false)}
      >
        <Logo expanded={logoExpanded} />
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
