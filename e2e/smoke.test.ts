import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';

test('smoke test - proper electron launch', async () => {
    // Launch without Playwright's default Chrome flags
    const electronApp = await electron.launch({
        args: ['.'],
        // Explicitly set a valid remote debugging port for Electron
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: undefined // Ensure we're not in Node mode
        },
        timeout: 30000
    });

    const window = await electronApp.firstWindow();
    await window.waitForSelector('.logo-text', { timeout: 15000 });
    await expect(window.locator('.logo-text')).toHaveText('SecureXfer');

    await electronApp.close();
});
