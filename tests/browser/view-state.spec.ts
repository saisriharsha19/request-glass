import {test,expect} from '@playwright/test';
test('navigation, calendar and record filters survive reload and Back/Forward coherently',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('[data-workspace="items"]')).toBeEnabled();
 await page.locator('#search').fill('headphones');await page.locator('#sort').selectOption('name');
 await page.locator('[data-workspace="planner"]').click();await page.locator('#month-jump').fill('2027-03');await page.locator('#agenda-filter').selectOption('completed');await page.locator('#calendar-source-filter').selectOption('tuckday');
 await expect(page.locator('#view-name')).toHaveText('Calendar');await expect(page.locator('.record-views')).toBeHidden();await expect(page.locator('.stats')).toBeHidden();
 await page.reload();await expect(page.locator('#planner-workspace')).toBeVisible();await expect(page.locator('#month-jump')).toHaveValue('2027-03');await expect(page.locator('#agenda-filter')).toHaveValue('completed');await expect(page.locator('#calendar-source-filter')).toHaveValue('tuckday');
 await page.locator('[data-workspace="insights"]').click();await expect(page).toHaveURL(/#insights$/);
 await page.goBack();await expect(page.locator('#planner-workspace')).toBeVisible();await expect(page.locator('#month-jump')).toHaveValue('2027-03');
 await page.goForward();await expect(page.locator('#insights-workspace')).toBeVisible();
 await page.locator('[data-workspace="items"]').click();await expect(page.locator('#search')).toHaveValue('headphones');await expect(page.locator('#sort')).toHaveValue('name');
 await page.locator('[data-view="archived"]').click();await page.reload();await expect(page.locator('[data-view="archived"]')).toHaveClass(/selected/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/tuckday-navigation-phone.png'});
});
test('account navigation state is isolated and untrusted saved data is ignored',async({page})=>{
 let user:any={id:'alice',username:'alice',name:'Alice'};
 await page.route('**/api/auth/config',r=>r.fulfill({json:{configured:true}}));await page.route('**/api/auth/session',r=>r.fulfill({json:{user}}));await page.route('**/api/purchases',r=>r.fulfill({json:{purchases:[],revision:0,next:null}}));
 await page.goto('/');await expect(page.locator('[data-workspace="items"]')).toBeEnabled();await page.locator('#search').fill('Alice private search');
 user={id:'bob',username:'bob',name:'Bob'};await page.reload();await expect(page.locator('#search')).toHaveValue('');
 await page.locator('[data-workspace="planner"]').click();await page.goBack();await expect(page.locator('#search')).toHaveValue('');
 await page.evaluate(()=>sessionStorage.setItem('tuckday:view:v1:bob','broken-json'));await page.reload();await expect(page.locator('[data-workspace="items"]')).toBeEnabled();
});
