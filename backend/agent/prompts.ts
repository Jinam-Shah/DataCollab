// Prompts for the agent. Two system prompts for the SQL-writing step ("A" and "B") are kept
// side by side for the A/B comparison in the evaluation (see eval/ and METRICS.md).
import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';

export type PromptVariant = 'A' | 'B';

const SQL_RULES_A = `You write PostgreSQL queries for a data analysis app.
Rules:
- Write exactly one SELECT statement.
- Only use the tables and columns listed in the schema.
- Quote table and column names with double quotes.
- Submit the query by calling the run_readonly_query tool.`;

const SQL_RULES_B = `You are a careful analyst who writes PostgreSQL to answer questions about uploaded CSV tables.

How to work:
1. Read the schema. Use only the tables and columns it lists, spelled exactly, in double quotes.
2. Decide which rows the question is about (filters), what to compute (aggregates), and how to group or order.
3. Write exactly one SELECT statement (CTEs are fine) and submit it by calling the run_readonly_query tool.

PostgreSQL details that matter:
- Text comparisons are case-sensitive. Match category values exactly as they appear in the samples, or use ILIKE when unsure.
- Dates are DATE columns: filter with date literals ('2024-03-01'), date_trunc, or EXTRACT(YEAR FROM col).
- Integer division truncates. Cast to numeric for averages and ratios, and ROUND(x::numeric, 2) for readable results.
- "Top N" and "highest/lowest" need ORDER BY with LIMIT N. Return only the columns the question needs, plus a label column.
- Count distinct things with COUNT(DISTINCT col).
- If a previous attempt failed, read the database error and fix that specific problem.`;

export function sqlSystemPrompt(variant: PromptVariant): string {
  return variant === 'B' ? SQL_RULES_B : SQL_RULES_A;
}

export interface Attempt {
  sql: string;
  error?: string;
  code?: string;
  rowCount?: number;
}

export function planMessages(question: string, tableList: string): BaseMessage[] {
  return [
    new SystemMessage(
      'You help answer questions about tables in a workspace. Call the get_schema tool with the ' +
        'tables needed to answer the question. If unsure, omit the tables argument to get every table.'
    ),
    new HumanMessage(`Tables:\n${tableList}\n\nQuestion: ${question}`),
  ];
}

export function writeSqlMessages(
  variant: PromptVariant,
  question: string,
  schemaText: string,
  attempts: Attempt[],
  documentContext?: string
): BaseMessage[] {
  let user = `Schema:\n${schemaText}\n\n`;
  if (documentContext) user += `Relevant document excerpts:\n${documentContext}\n\n`;
  user += `Question: ${question}`;
  if (attempts.length) {
    user += '\n\nPrevious attempts:';
    attempts.forEach((a, i) => {
      user += `\n${i + 1}. ${a.sql}\n   -> ${
        a.error ? `ERROR (${a.code}): ${a.error}` : `returned ${a.rowCount} rows`
      }`;
    });
    const last = attempts[attempts.length - 1];
    user += last.error
      ? '\nFix the error and submit a corrected query.'
      : '\nThe last query returned no rows. Check filters and value spelling against the samples. ' +
        'If no rows really is the correct answer, submit the same query again.';
  }
  return [new SystemMessage(sqlSystemPrompt(variant)), new HumanMessage(user)];
}

/** The original single-shot NL-to-SQL prompt, generalized to several tables. Used as the baseline. */
export function singleShotMessages(question: string, schemaText: string): BaseMessage[] {
  return [
    new HumanMessage(`You are a SQL query generator. Convert the natural language question into a valid PostgreSQL SELECT query.

TABLE INFORMATION:
${schemaText}

RULES:
1. Only generate SELECT queries
2. Use double quotes for table and column names
3. Return ONLY the SQL query, no explanation
4. Do not use markdown code blocks
5. Ensure the query is valid PostgreSQL syntax

QUESTION: ${question}

SQL QUERY:`),
  ];
}

export function summarizePrompt(input: {
  question: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  hasMore?: boolean;
}): BaseMessage[] {
  const shown = input.rows.slice(0, 20);
  return [
    new SystemMessage(
      'Answer the question in 1-3 plain-English sentences using only the query result. ' +
        'Quote the key numbers exactly. If the result is empty, say that no matching rows were found. ' +
        'Do not mention SQL.'
    ),
    new HumanMessage(
      `Question: ${input.question}\nColumns: ${input.columns.join(', ')}\n` +
        `Rows (${input.rowCount}${input.hasMore ? '+, truncated' : ''}):\n${JSON.stringify(shown)}`
    ),
  ];
}
