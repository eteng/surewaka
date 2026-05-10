import { z } from 'zod';
import { tool } from 'ai';

export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: T;
  execute: (params: z.infer<T>) => Promise<unknown>;
}

/**
 * Create a type-safe tool definition compatible with Vercel AI SDK.
 */
export function createTool<T extends z.ZodType>(definition: ToolDefinition<T>) {
  return tool({
    description: definition.description,
    parameters: definition.parameters,
    execute: definition.execute,
  });
}
