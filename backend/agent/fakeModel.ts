// Deterministic chat model for end-to-end tests (LLM_PROVIDER=fake). Never used in production.
// FAKE_LLM_SCRIPT points to JSON mapping a question to the SQL replies to give, in order:
//   { "Total amount by region?": ["SELECT regon FROM sales", "SELECT region, sum(amount) ..."] }
// The n-th write_sql call for a question returns the n-th entry (the last one repeats), so a
// script can make the first attempt fail and show the retry path in the UI.
import fs from 'fs';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

function loadScript(): Record<string, string[]> {
  const file = process.env.FAKE_LLM_SCRIPT;
  if (!file || !fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let id = 0;
const call = (name: string, args: Record<string, unknown>) =>
  new AIMessage({
    content: '',
    tool_calls: [{ id: `fake_${++id}`, name, args, type: 'tool_call' }],
  });

export class FakeScriptedModel extends BaseChatModel {
  _llmType(): string {
    return 'fake';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(): any {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const all = messages.map((m) => String(m.content)).join('\n');
    const question =
      (all.match(/QUESTION: (.*)|Question: (.*)/) || []).slice(1).find(Boolean)?.trim() ?? '';
    const replies = loadScript()[question] ?? ['SELECT 1 AS answer'];
    let message: AIMessage;

    if (all.includes('Call the get_schema tool')) {
      message = call('get_schema', {});
    } else if (all.includes('run_readonly_query')) {
      // Each earlier attempt is listed with a '   -> result' line under it.
      const attempt = (all.match(/\n {3}-> /g) || []).length;
      message = call('run_readonly_query', { sql: replies[Math.min(attempt, replies.length - 1)] });
    } else if (all.includes('SQL QUERY:')) {
      message = new AIMessage(replies[replies.length - 1]);
    } else {
      const rows = all.match(/Rows \(\d+.*?\):\n(.*)/s)?.[1] ?? '';
      message = new AIMessage(`Answer based on ${rows.slice(0, 120)}`);
    }
    return { generations: [{ message, text: String(message.content) }] };
  }
}
