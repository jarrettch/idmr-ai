import type React from "react";

/**
 * Render markdown-like text with basic formatting (headers, lists, bold,
 * italic, links) without pulling in a full markdown library.
 */
export function FormattedText({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <>
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith("## ")) {
          return <h2 key={i}>{formatInline(line.slice(3))}</h2>;
        }
        if (line.startsWith("### ")) {
          return <h3 key={i}>{formatInline(line.slice(4))}</h3>;
        }
        // Unordered list
        if (line.startsWith("- ")) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-purple-400 shrink-0">&#8226;</span>
              <span>{formatInline(line.slice(2))}</span>
            </div>
          );
        }
        // Numbered list
        const numMatch = line.match(/^(\d+)\.\s/);
        if (numMatch) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-purple-400 shrink-0">{numMatch[1]}.</span>
              <span>{formatInline(line.slice(numMatch[0].length))}</span>
            </div>
          );
        }
        // Empty line
        if (line.trim() === "") {
          return <div key={i} className="h-2" />;
        }
        // Regular paragraph
        return <p key={i}>{formatInline(line)}</p>;
      })}
    </>
  );
}

function formatInline(text: string): React.ReactNode {
  // Handle links [text](url), bold (**text**), and italic (*text*)
  const parts: React.ReactNode[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] && match[2]) {
      // Link: [text](url)
      parts.push(
        <a
          key={match.index}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-purple-400 hover:text-purple-300 underline underline-offset-2"
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      // Bold: **text**
      parts.push(
        <strong key={match.index} className="font-semibold text-gray-100">
          {match[3]}
        </strong>
      );
    } else if (match[4]) {
      // Italic: *text*
      parts.push(
        <em key={match.index} className="italic text-gray-300">
          {match[4]}
        </em>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
