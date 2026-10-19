// A fake chat model for tests. Replies come from a script; each reply is an AIMessage or a
// function of the prompt messages. bindTools() is accepted and recorded but changes nothing.
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

export type Reply = AIMessage | ((messages: BaseMessage[]) => AIMessage);

export class ScriptedChatModel extends BaseChatModel {
  replies: Reply[];
  calls: BaseMessage[][] = [];
  boundTools: string[][] = [];

  constructor(replies: Reply[]) {
    super({});
    this.replies = [...replies];
  }

  _llmType(): string {
    return 'scripted';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(tools: any[]): any {
    this.boundTools.push(tools.map((t) => t.name));
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const next = this.replies.shift();
    if (!next) throw new Error('ScriptedChatModel ran out of replies');
    const message = typeof next === 'function' ? next(messages) : next;
    return { generations: [{ message, text: String(message.content) }] };
  }
}

let callId = 0;
export const toolCall = (
  name: string,
  args: Record<string, unknown>,
  usage = { input: 10, output: 5 }
) =>
  new AIMessage({
    content: '',
    tool_calls: [{ id: `call_${++callId}`, name, args, type: 'tool_call' }],
    usage_metadata: {
      input_tokens: usage.input,
      output_tokens: usage.output,
      total_tokens: usage.input + usage.output,
    },
  });

export const text = (content: string) => new AIMessage({ content });
