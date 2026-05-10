import { generateText } from 'ai';
import { createLLMClient } from '@surewaka/ai';
import { lookupDeliveryTool } from '../../shared/tools';
import { getConversation, addMessage } from '../../shared/memory/conversation';
import { readFileSync } from 'fs';
import { join } from 'path';

const systemPrompt = readFileSync(join(__dirname, '../prompts/system.md'), 'utf-8');

/**
 * Customer support agent for SureWaka.
 * Handles: delivery tracking, order inquiries, general questions.
 * Escalates: complaints, refunds, safety issues.
 */
export async function handleCustomerMessage(sessionId: string, userMessage: string) {
  const conversation = getConversation(sessionId);
  addMessage(sessionId, { role: 'user', content: userMessage });

  const model = createLLMClient({ provider: 'openai', model: 'gpt-4o-mini' });

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: conversation.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    tools: {
      lookup_delivery: lookupDeliveryTool,
    },
    maxSteps: 5,
  });

  addMessage(sessionId, { role: 'assistant', content: result.text });

  return {
    response: result.text,
    toolCalls: result.steps.flatMap((s) => s.toolCalls),
  };
}
