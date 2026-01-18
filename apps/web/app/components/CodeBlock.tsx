import { CopyButton } from "./CopyButton";

interface CodeBlockProps {
  code: string;
}

export function CodeBlock({ code }: CodeBlockProps) {
  const tokenize = (text: string) => {
    const regex =
      /(\b(?:import|from|const|await|new|async|function|return|export|class)\b)|('[^']*'|"[^"]*")|(\b(?:Kawarp|KawarpComponent|document|canvas|kawarp)\b)|(\/\/.*)|(\.\w+(?=\())|([^'"\s]+|\s+)/g;

    const matches = text.matchAll(regex);
    const tokens: { text: string; type: string; id: string }[] = [];

    let idx = 0;
    for (const match of matches) {
      const id = `${idx++}-${match[0].slice(0, 8)}`;
      if (match[1]) tokens.push({ text: match[1], type: "keyword", id });
      else if (match[2]) tokens.push({ text: match[2], type: "string", id });
      else if (match[3]) tokens.push({ text: match[3], type: "type", id });
      else if (match[4]) tokens.push({ text: match[4], type: "comment", id });
      else if (match[5]) tokens.push({ text: match[5], type: "method", id });
      else if (match[6]) tokens.push({ text: match[6], type: "plain", id });
    }
    return tokens;
  };

  const colors: Record<string, string> = {
    keyword: "#c084fc",
    string: "#34d399",
    type: "#38bdf8",
    method: "#fbbf24",
    comment: "#71717a",
    plain: "#d4d4d8",
  };

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-900/80 p-4 pr-12 text-sm">
        <code>
          {tokenize(code).map((token) => (
            <span key={token.id} style={{ color: colors[token.type] }}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
      <CopyButton
        text={code}
        className="absolute right-3 top-3 md:opacity-0 md:group-hover:opacity-100"
      />
    </div>
  );
}
