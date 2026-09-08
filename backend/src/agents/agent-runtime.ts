import Anthropic from "@anthropic-ai/sdk";

// Generic Claude tool-use loop shared by every agent in this layer
// (CadreAgent today; FieldIntelligenceAgent does single-shot extraction
// instead and doesn't need this). Not a framework — just the minimal
// "call model -> execute any tool_use blocks -> feed results back -> repeat
// until the model stops asking for tools" loop, capped so a
// misbehaving/looping tool call can't run forever.
export interface AgentToolDef {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
}

export interface ToolCallTrace {
  name: string;
  input: unknown;
  output: unknown;
}

export interface ToolLoopResult {
  finalText: string;
  toolCalls: ToolCallTrace[];
}

const MAX_STEPS = 4;

export async function runToolLoop(
  client: Anthropic,
  opts: {
    model: string;
    system: string;
    tools: AgentToolDef[];
    executeTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
    userMessage: string;
    maxTokens?: number;
  },
): Promise<ToolLoopResult> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.userMessage }];
  const toolCalls: ToolCallTrace[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 500,
      system: opts.system,
      tools: opts.tools as Anthropic.Tool[],
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      return { finalText: textBlock && textBlock.type === "text" ? textBlock.text : "", toolCalls };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const output = await opts.executeTool(block.name, (block.input ?? {}) as Record<string, unknown>);
      toolCalls.push({ name: block.name, input: block.input, output });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    finalText: "I'm having trouble completing that request right now — please try rephrasing, or reply MENU for the basic options.",
    toolCalls,
  };
}
