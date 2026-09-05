import { test, expect } from '@playwright/test';

test('set() — one-time push of a single resource', async ({ page }) => {
    await page.goto('/tests/test-set.html');

    const el = page.locator('#test-complete');
    // Wait for tests to finish (element gets data-status attribute)
    await expect(el).toHaveAttribute('data-status', /.+/, { timeout: 15000 });

    const status = await el.getAttribute('data-status');
    const text = await el.textContent();

    expect(status, text ?? undefined).toBe('pass');
    expect(text).toContain('tests passed');
});
