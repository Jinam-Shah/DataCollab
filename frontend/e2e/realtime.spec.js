import { test, expect } from '@playwright/test';
import { signUp, uniqueUser, uploadCsv, fixture } from './helpers';

test('an upload and a chat message in one session appear live in another session', async ({
  browser,
}) => {
  const workspace = `sync-${Date.now().toString(36)}`;
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const pageA = await alice.newPage();
  const pageB = await bob.newPage();
  await signUp(pageA, uniqueUser(workspace));
  await signUp(pageB, uniqueUser(workspace));

  // A third user in a different workspace must not see anything.
  const eve = await browser.newContext();
  const pageE = await eve.newPage();
  await signUp(pageE, uniqueUser(`${workspace}-other`));

  await expect(pageB.getByText('No files uploaded yet')).toBeVisible();
  await uploadCsv(pageA, fixture('sales.csv'));
  await expect(pageA.getByTestId('quality-report')).toBeVisible();

  // Bob's file list refreshes from the socket event, without reloading.
  await expect(pageB.getByText('sales.csv')).toBeVisible();

  await pageA.getByPlaceholder(/message/i).fill('hello from alice');
  await pageA.getByPlaceholder(/message/i).press('Enter');
  await expect(pageB.getByText('hello from alice')).toBeVisible();

  await expect(pageE.getByText('sales.csv')).toHaveCount(0);
  await expect(pageE.getByText('hello from alice')).toHaveCount(0);

  await alice.close();
  await bob.close();
  await eve.close();
});
