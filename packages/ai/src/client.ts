import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

export interface LLMConfig {
  provider: 'openai' | 'anthropic';
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
} as const;

/**
 * Create a configured LLM client for use with Vercel AI SDK.
 * Abstracts provider selection so agents don't need to know which LLM they're using.
 */
export function createLLMClient(config: LLMConfig) {
  const { provider, model } = config;
  const modelId = model || DEFAULT_MODELS[provider];

  switch (provider) {
    case 'openai':
      return openai(modelId);
    case 'anthropic':
      return anthropic(modelId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
