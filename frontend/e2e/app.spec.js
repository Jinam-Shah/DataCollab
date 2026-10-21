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
  // Every row, a page at a time
  await page.getByRole('tab', { name: 'All rows' }).click();
  await expect(page.getByTestId('rows-browser')).toContainText('Rows 1–5 of 5');

  // Download the table as CSV
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sales.csv');

  // SQL for this table
  await page.getByRole('tab', { name: 'SQL query' }).click();
  await expect(page.getByText(/Querying sales\.csv/)).toBeVisible();
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
  await page.getByRole('tab', { name: 'Ask AI' }).click();
  await expect(page.getByTestId('source-picker')).toContainText('1 table(s), 0 document(s)');
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
  await expect(page).toHaveURL(/\/sql$/);
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
  await page.getByRole('tab', { name: 'SQL query' }).click();
  // Wait for Monaco to finish loading before typing, or the keystrokes are lost.
  const editor = page.locator('.monaco-editor .view-lines').first();
  await expect(editor).toBeVisible();
  await editor.click();
  // insertText adds the text in one input event; typing key by key can race with Monaco's
  // suggestion widget on slow CI machines and lose or reorder characters.
  await page.keyboard.insertText('DELETE FROM sales');
  await expect(editor).toContainText('DELETE FROM sales');
  await page.getByRole('button', { name: 'Run Query' }).click();
  await expect(page.getByText(/Only SELECT queries are allowed/)).toBeVisible();
});

test('a Markdown document can be uploaded and read on the Documents page', async ({ page }) => {
  await signUp(page, uniqueUser(`ws-${Date.now().toString(36)}-d`));
  await page.getByRole('link', { name: 'Documents' }).click();
  await page.locator('#document-input').setInputFiles({
    name: 'dictionary.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Columns\n\nThe region column is the sales territory.\n'),
  });
  const viewer = page.getByTestId('document-viewer');
  await expect(viewer).toContainText('dictionary.md');
  await expect(viewer).toContainText('The region column is the sales territory.');
  await expect(page.getByTestId('documents-panel')).toContainText('dictionary.md');
});

test('the Integrations page creates a token and puts it in the setup snippet', async ({ page }) => {
  await signUp(page, uniqueUser(`ws-${Date.now().toString(36)}-t`));
  await page.getByRole('link', { name: 'Integrations' }).click();
  await page.getByLabel('Token name').fill('Claude Desktop');
  await page.getByRole('button', { name: 'Create token' }).click();
  const token = await page.getByRole('status').locator('code').textContent();
  expect(token).toMatch(/^dc_/);
  await expect(page.locator('pre').filter({ hasText: 'mcp-remote' })).toContainText(token);
  await expect(page.getByTestId('api-tokens')).toContainText('Claude Desktop');
});

test('the Ask AI page lets you choose which tables and documents to use', async ({ page }) => {
  await signUp(page, uniqueUser(`ws-${Date.now().toString(36)}-s`));
  await uploadCsv(page, fixture('sales.csv'));
  await expect(page.getByTestId('quality-report')).toBeVisible();
  await page.getByRole('link', { name: 'Ask AI' }).click();
  const picker = page.getByTestId('source-picker');
  await expect(picker).toContainText('1 table(s), 0 document(s) selected');
  const chip = picker.getByRole('button', { name: 'sales.csv' });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.click();
  await expect(picker).toContainText('0 table(s)');
  await expect(page.getByLabel('Question')).toBeDisabled();
  await chip.click();
  await expect(page.getByLabel('Question')).toBeEnabled();
});
