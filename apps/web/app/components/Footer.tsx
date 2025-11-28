import Image from "next/image";

const BETTER_LYRICS_ICON =
  "https://raw.githubusercontent.com/better-lyrics/better-lyrics/refs/heads/master/images/icons/icon-512.png";

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-zinc-950/90 px-6 py-8 backdrop-blur-xl">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-5">
        <a
          href="https://better-lyrics.boidu.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-2 rounded-full border border-white/10 bg-linear-to-br from-white/2 via-white/5 to-white/5 py-2 pl-2 pr-3 transition-colors hover:border-white/20 hover:bg-white/10"
        >
          <Image
            src={BETTER_LYRICS_ICON}
            alt="Better Lyrics"
            width={20}
            height={20}
            className="rounded"
          />
          <span className="text-sm text-zinc-400 group-hover:text-zinc-200">
            Part of the{" "}
            <span className="font-medium text-zinc-300">Better Lyrics</span>{" "}
            ecosystem
          </span>
        </a>
      </div>
    </footer>
  );
}
