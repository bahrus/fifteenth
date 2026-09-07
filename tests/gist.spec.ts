import { test, expect } from '@playwright/test';

test('gist protocol (stubbed GitHub transport)', async ({ page }) => {
    await page.goto('/tests/test-gist.html');

    const el = page.locator('#test-complete');
    await expect(el).toHaveAttribute('data-status', /.+/, { timeout: 15000 });

    const status = await el.getAttribute('data-status');
    const text = await el.textContent();

    expect(status, text ?? undefined).toBe('pass');
    expect(text).toContain('tests passed');
});
