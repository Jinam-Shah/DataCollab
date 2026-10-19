import { test, expect } from '@playwright/test';
import { signUp, uniqueUser, uploadCsv, fixture } from './helpers';

test('sign up, upload a CSV, read the quality report, query, chart and ask the agent', async ({
  page,
}) => {
  const user = uniqueUser(`ws-${Date.now().toString(36)}`);
  await signUp(page, user);

  // Upload and quality report
  await uploadCsv(page, fixture('sales.csv'));
  const report = page.getByTestId('quality-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('5 rows, 3 columns, 1 duplicate rows');
  await expect(report.getByRole('alert').filter({ hasText: '"code" mixes' })).toBeVisible();
  await expect(
    report.getByRole('alert').filter({ hasText: '"amount" is 80% empty' })
  ).toBeVisible();

  // Query in the editor
  await page.getByRole('button', { name: 'Count rows' }).click();
  await page.getByRole('button', { name: 'Run Query' }).click();
  await expect(page.getByText('Results (1 rows)')).toBeVisible();

  await page.getByRole('button', { name: 'View all data' }).click();
  await page.getByRole('button', { name: 'Run Query' }).click();
  await expect(page.getByText('Results (5 rows)')).toBeVisible();

  // Chart from the result
  await page.getByLabel('X axis').selectOption('region');
  await page.getByLabel('Y axis').selectOption('amount');
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();

  // Agent with the scripted LLM: the first SQL has a typo, the second is correct.
  await page.getByLabel('Question').fill('What is the total amount per region?');
  await page.getByRole('button', { name: 'Ask' }).click();
  const steps = page.getByTestId('agent-steps');
  await expect(steps).toContainText('Query failed: column "regon" does not exist');
  await expect(steps).toContainText('Retrying (attempt 2)');
  const result = page.getByTestId('agent-result');
  await expect(result).toContainText(
    'SELECT region, sum(amount) AS total FROM sales GROUP BY region ORDER BY region'
  );
  await expect(result).toContainText('2 attempt(s)');
  await result.getByRole('button', { name: 'Open in editor' }).click();
  await page.getByRole('button', { name: 'Run Query' }).click();
  await expect(page.getByText('Results (3 rows)')).toBeVisible();

  // The run is in the history with its steps
  await page.getByRole('link', { name: 'Run history' }).click();
  await page.getByRole('button', { name: /What is the total amount per region/ }).click();
  await expect(page.getByTestId('run-detail')).toContainText('check_result');
});

test('blocks writes from the SQL editor', async ({ page }) => {
  await signUp(page, uniqueUser(`ws-${Date.now().toString(36)}-w`));
  await uploadCsv(page, fixture('sales.csv'));
  await expect(page.getByTestId('quality-report')).toBeVisible();
  // Wait for Monaco to finish loading before typing, or the keystrokes are lost.
  const editor = page.locator('.monaco-editor .view-lines').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('DELETE FROM sales');
  await expect(editor).toContainText('DELETE FROM sales');
  await page.getByRole('button', { name: 'Run Query' }).click();
  await expect(page.getByText(/Only SELECT queries are allowed/)).toBeVisible();
});
