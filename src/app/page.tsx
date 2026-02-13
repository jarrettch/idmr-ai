"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";

const STORAGE_KEY = "idmr-chat-messages";

export default function Home() {
  const { messages, sendMessage, setMessages, status } = useChat();
  const [input, setInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "streaming" || status === "submitted";

  // Load messages from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      } catch (e) {
        console.error("Failed to parse saved messages:", e);
      }
    }
    setHydrated(true);
  }, [setMessages]);

  // Save messages to localStorage when they change
  useEffect(() => {
    if (hydrated && messages.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [messages, hydrated]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [input]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleNewChat() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4 pb-4 pt-6">
      <div className="mb-6 flex items-center justify-center gap-3">
        <h1 className="text-center text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-400 via-purple-400 to-rose-400 bg-clip-text text-transparent">
          IDMR AI
        </h1>
        {messages.length > 0 && (
          <button
            onClick={handleNewChat}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors"
          >
            New chat
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-24 gap-3">
            <p className="text-lg text-gray-400">
              Ask about IDMR transcripts or the textbook
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {[
                "Summarize the Here I Am transcript",
                "What does the Archetype say about the heart?",
                "What does Dr. Kinley teach about 666?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    sendMessage({ text: suggestion });
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-2xl px-4 py-3 ${
              m.role === "user"
                ? "ml-auto max-w-[80%] bg-gradient-to-br from-blue-600 to-purple-600"
                : "mr-auto max-w-[90%] bg-white/5 border border-white/10"
            }`}
          >
            {m.parts.map((part, i) =>
              part.type === "text" ? (
                <div
                  key={i}
                  className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed [&>h2]:text-base [&>h2]:font-semibold [&>h2]:mt-4 [&>h2]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:mt-3 [&>h3]:mb-1 [&>ul]:my-1 [&>ol]:my-1 [&>p]:my-1.5"
                >
                  <FormattedText text={part.text} />
                </div>
              ) : null
            )}
          </div>
        ))}
        {isLoading && messages.at(-1)?.role !== "assistant" && (
          <div className="mr-auto max-w-[90%] rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-sm text-gray-400">Searching & thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/5 p-2"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about IDMR teachings..."
          rows={1}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none placeholder:text-gray-500"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-1.5 text-sm font-medium transition-opacity disabled:opacity-30 hover:opacity-90"
        >
          Send
        </button>
      </form>
    </main>
  );
}

/**
 * Render markdown-like text with basic formatting.
 * Handles bold, headers, and lists without pulling in a full markdown library.
 */
function FormattedText({ text }: { text: string }) {
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
