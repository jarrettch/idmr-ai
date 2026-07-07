import type { UIMessage } from "ai";

// Local (localStorage) multi-conversation store. Shapes deliberately mirror the
// planned Supabase `conversations` / `messages` tables so a future "sign in to
// save" migration is a straight read-here → insert-there, no reshaping:
//   ConversationMeta ↔ conversations (id, title, created_at, updated_at)
//   stored UIMessage[] ↔ messages (role, parts) grouped by conversation_id
export interface ConversationMeta {
  id: string;
  title: string | null; // null until derived from the first user message
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

const INDEX_KEY = "idmr-conversations";
const messagesKey = (id: string) => `idmr-messages:${id}`;

const hasWindow = () => typeof window !== "undefined";

function nowIso(): string {
  return new Date().toISOString();
}

function readIndex(): ConversationMeta[] {
  if (!hasWindow()) return [];
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConversationMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: ConversationMeta[]): void {
  if (!hasWindow()) return;
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

/** Conversations, most recently updated first. */
export function listConversations(): ConversationMeta[] {
  return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(id: string): ConversationMeta | undefined {
  return readIndex().find((c) => c.id === id);
}

export function createConversation(): ConversationMeta {
  const meta: ConversationMeta = {
    id: hasWindow() ? crypto.randomUUID() : "",
    title: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeIndex([meta, ...readIndex()]);
  return meta;
}

export function deleteConversation(id: string): void {
  if (!hasWindow()) return;
  writeIndex(readIndex().filter((c) => c.id !== id));
  localStorage.removeItem(messagesKey(id));
}

export function renameConversation(id: string, title: string): void {
  const list = readIndex().map((c) =>
    c.id === id ? { ...c, title, updatedAt: nowIso() } : c
  );
  writeIndex(list);
}

export function loadMessages(id: string): UIMessage[] {
  if (!hasWindow()) return [];
  try {
    const raw = localStorage.getItem(messagesKey(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persist a conversation's messages and bump its `updatedAt`. Derives a title
 * from the first user message the first time one exists (mirrors the auto-title
 * behavior we'll eventually move server-side with a cheap Haiku call).
 */
export function saveConversation(id: string, messages: UIMessage[]): void {
  if (!hasWindow()) return;
  localStorage.setItem(messagesKey(id), JSON.stringify(messages));

  const list = readIndex();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return;

  const current = list[idx];
  const title = current.title ?? deriveTitle(messages);
  list[idx] = { ...current, title, updatedAt: nowIso() };
  writeIndex(list);
}

/** Whether a conversation has no stored messages (a fresh "New chat"). */
export function isEmptyConversation(id: string): boolean {
  return loadMessages(id).length === 0;
}

/** A short title from the first user message; null if there isn't one yet. */
export function deriveTitle(messages: UIMessage[]): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return null;

  const text = firstUser.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ")
    .trim();
  if (!text) return null;

  const words = text.split(/\s+/);
  const short = words.slice(0, 6).join(" ");
  return short.length < text.length ? `${short}…` : short;
}
