/**
 * Conversation memory management for agents.
 * Uses Redis for fast access, with optional persistence to PostgreSQL.
 */

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
}

export interface ConversationMemory {
  sessionId: string;
  messages: Message[];
  metadata: Record<string, unknown>;
}

/**
 * In-memory store for development. Replace with Redis in production.
 */
const memoryStore = new Map<string, ConversationMemory>();

export function getConversation(sessionId: string): ConversationMemory {
  if (!memoryStore.has(sessionId)) {
    memoryStore.set(sessionId, { sessionId, messages: [], metadata: {} });
  }
  return memoryStore.get(sessionId)!;
}

export function addMessage(sessionId: string, message: Omit<Message, 'timestamp'>): void {
  const conversation = getConversation(sessionId);
  conversation.messages.push({ ...message, timestamp: new Date() });
}

export function clearConversation(sessionId: string): void {
  memoryStore.delete(sessionId);
}
