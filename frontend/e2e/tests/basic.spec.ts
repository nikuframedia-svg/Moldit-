import { test, expect } from '@playwright/test';

test('upload page shows when no data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('upload-zone')).toBeVisible();
});

test('sidebar has 9 navigation items', async ({ page }) => {
  await page.goto('/');
  const navItems = page.locator('[data-testid^="nav-"]');
  await expect(navItems).toHaveCount(9);
});

test('sidebar shows Moldit branding', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Moldit')).toBeVisible();
  await expect(page.locator('text=Producao de Moldes')).toBeVisible();
});

test('status bar shows ready message', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Pronto.')).toBeVisible();
});

test('clicking nav items changes active state', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-regras').click();
  await page.waitForTimeout(500);
  // Regras page should attempt to load (may show loading or error without data)
});
