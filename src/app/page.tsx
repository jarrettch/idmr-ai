"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";
import { FormattedText } from "@/components/formatted-text";
import {
  type ConversationMeta,
  listConversations,
  createConversation,
  deleteConversation,
  loadMessages,
  saveConversation,
  isEmptyConversation,
  migrateLegacyConversation,
} from "@/lib/conversations";

export default function Home() {
  const { messages, sendMessage, setMessages, status } = useChat();
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "streaming" || status === "submitted";

  // On mount: load the conversation list and open the most recent one, or
  // start a fresh conversation if there are none.
  useEffect(() => {
    migrateLegacyConversation();
    const list = listConversations();
    if (list.length > 0) {
      setActiveId(list[0].id);
      setMessages(loadMessages(list[0].id));
    } else {
      const created = createConversation();
      setActiveId(created.id);
    }
    setConversations(listConversations());
    setHydrated(true);
  }, [setMessages]);

  // Persist the active conversation whenever its messages change.
  useEffect(() => {
    if (hydrated && activeId && messages.length > 0) {
      saveConversation(activeId, messages);
      setConversations(listConversations());
    }
  }, [messages, hydrated, activeId]);

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

  function selectConversation(id: string) {
    if (isLoading || id === activeId) return;
    setActiveId(id);
    setMessages(loadMessages(id));
    setSidebarOpen(false);
  }

  function handleNewChat() {
    if (isLoading) return;
    // Reuse the current conversation if it's already an empty "New chat".
    if (activeId && messages.length === 0 && isEmptyConversation(activeId)) {
      setSidebarOpen(false);
      textareaRef.current?.focus();
      return;
    }
    const created = createConversation();
    setActiveId(created.id);
    setMessages([]);
    setConversations(listConversations());
    setSidebarOpen(false);
    textareaRef.current?.focus();
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (isLoading) return;
    deleteConversation(id);
    const remaining = listConversations();
    if (id === activeId) {
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
        setMessages(loadMessages(remaining[0].id));
      } else {
        const created = createConversation();
        setActiveId(created.id);
        setMessages([]);
      }
    }
    setConversations(listConversations());
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading || !activeId) return;
    sendMessage({ text: input });
    setInput("");
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

  return (
    <div className="flex h-dvh">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-white/10 bg-black/40 backdrop-blur px-3 py-4 transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={handleNewChat}
          disabled={isLoading}
          className="mb-4 flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          <span className="text-lg leading-none">+</span> New chat
        </button>

        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1">
          {conversations.length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-500">No conversations yet</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              data-testid="conversation-item"
              data-active={c.id === activeId}
              onClick={() => selectConversation(c.id)}
              className={`group flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer transition-colors ${
                c.id === activeId
                  ? "bg-white/10 text-gray-100"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
              }`}
            >
              <span data-testid="conversation-title" className="truncate">
                {c.title ?? "New chat"}
              </span>
              <button
                onClick={(e) => handleDelete(c.id, e)}
                aria-label="Delete conversation"
                className="shrink-0 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity"
              >
                &#215;
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
        />
      )}

      {/* Main column */}
      <main className="flex min-w-0 flex-1 flex-col px-4 pb-4 pt-6">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col min-h-0">
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open conversations"
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-300 hover:bg-white/10 md:hidden"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <h1 className="flex-1 text-center text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-400 via-purple-400 to-rose-400 bg-clip-text text-transparent">
              IDMR AI
            </h1>
            {/* Spacer to balance the mobile menu button */}
            <div className="w-9 md:hidden" />
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
                        if (!activeId || isLoading) return;
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
                data-testid="message"
                data-role={m.role}
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
        </div>
      </main>
    </div>
  );
}
