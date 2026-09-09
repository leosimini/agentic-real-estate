import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('mobile discovery shell is responsive and has no serious accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /Encontrá un lugar/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Casa contemporánea abierta a un patio en Mendoza/ })).toBeVisible();
  await expect(page.locator('.heroVisual').getByText('Imagen de referencia', { exact: true })).toBeVisible();
  const bounds = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(bounds.document).toBe(bounds.viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transitionDuration = await page.locator('.heroVisual img').evaluate((element) => getComputedStyle(element).transitionDuration);
  const transitionMs = transitionDuration.endsWith('ms') ? Number.parseFloat(transitionDuration) : Number.parseFloat(transitionDuration) * 1000;
  expect(transitionMs).toBeLessThanOrEqual(0.02);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
});

test('account session is HttpOnly, survives reload, and is removed on logout', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Vos', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Creá tu espacio' });
  await expect(dialog).toBeVisible();

  const close = dialog.getByRole('button', { name: 'Cerrar' });
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Volver a ingresar' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  const email = `browser-${crypto.randomUUID()}@example.test`;
  await dialog.getByRole('textbox', { name: 'Nombre' }).fill('Prueba navegador');
  await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
  await dialog.getByRole('textbox', { name: 'Contraseña' }).fill('contraseña segura de navegador');
  await dialog.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByText('Tu espacio está listo. Revisá tu email para verificar la cuenta.')).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('agentic-real-estate-token'))).toBeNull();
  const session = (await context.cookies()).find((cookie) => cookie.name === 'umbral_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Vos' }).click();
  await expect(page.getByRole('heading', { name: 'Sesión activa' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: /Encontrá un lugar/ })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === 'umbral_session')).toBeUndefined();
});
