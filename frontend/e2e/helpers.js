import { expect } from '@playwright/test';
import path from 'path';

// Playwright compiles specs to CommonJS here, so __dirname is available.
export const fixture = (name) => path.join(__dirname, 'fixtures', name);

let n = 0;
export function uniqueUser(workspace) {
  n += 1;
  const id = `${Date.now().toString(36)}${n}`;
  return { username: `e2e${id}`, email: `e2e${id}@test.dev`, password: 'secret123', workspace };
}

export async function signUp(page, user) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByLabel(/Workspace ID/).fill(user.workspace);
  if (user.inviteCode) await page.getByLabel(/Invite code/).fill(user.inviteCode);
  await page.getByRole('button', { name: 'Sign Up' }).click();
  // The creator of a new workspace lands on the Team page, a member who joined on Data.
  await expect(page).toHaveURL(/\/app\/(data|team)/);
  await expect(page.getByText(`Workspace: ${user.workspace}`)).toBeVisible();
  await page.getByRole('link', { name: 'Data', exact: true }).click();
}

export async function uploadCsv(page, file) {
  await page.locator('#file-input').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
}

// The invite code shown on the Team page, for signing teammates up into the same workspace.
export async function readInviteCode(page) {
  await page.getByRole('link', { name: 'Team' }).click();
  const code = (await page.getByTestId('invite-code').textContent()).trim();
  await page.getByRole('link', { name: 'Data', exact: true }).click();
  return code;
}
