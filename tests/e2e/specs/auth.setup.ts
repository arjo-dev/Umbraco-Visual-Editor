import { test as setup } from '@playwright/test';
import { UiHelpers } from '@umbraco-cms/acceptance-test-helpers';
import { STORAGE_STATE } from '../playwright.config.ts';

/** Signs in once and keeps the session for the specs (playwright.config.ts says whose). */
setup('sign in to the backoffice', async ({ page }) => {
	const umbracoUi = new UiHelpers(page);
	await umbracoUi.goToBackOffice();
	await umbracoUi.login.enterEmail(process.env.UMBRACO_USER_LOGIN!);
	await umbracoUi.login.enterPassword(process.env.UMBRACO_USER_PASSWORD!);
	await umbracoUi.login.clickLoginButtonAndWaitForBackOffice();
	await page.context().storageState({ path: STORAGE_STATE });
});
