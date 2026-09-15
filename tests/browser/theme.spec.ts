import {test,expect} from '@playwright/test';
test('theme follows system, remembers overrides across pages, and sync stays in the header',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 await page.route('**/api/auth/config',r=>r.fulfill({json:{configured:true}}));
 await page.route('**/api/auth/session',r=>r.fulfill({json:{user:{id:'theme-user',name:'Maya',username:'maya'}}}));
 await page.route('**/api/purchases*',r=>r.fulfill({json:{purchases:[],revision:0,next:null}}));
 await page.goto('/');await expect(page.locator('[data-workspace="items"]')).toBeEnabled();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('main #sync-title')).toContainText('Hi, Maya');
 await expect(page.locator('header #sync-now')).toBeVisible();
 await page.locator('#sync-now').click();await expect(page.locator('header #sync-message')).toContainText('Checked');
 await page.locator('[data-theme-picker]').selectOption('light');await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.goto('/account');await expect(page.locator('[data-theme-picker]')).toHaveValue('light');
 await page.locator('[data-theme-picker]').selectOption('system');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
test('light and dark pages and dialogs fit phones and share the warm background',async({page})=>{
 for(const theme of ['light','dark']) {
  await page.goto('/');await expect(page.locator('[data-workspace="items"]')).toBeEnabled();
  await page.locator('[data-theme-picker]').selectOption(theme);
  for(const width of [320,390,768,1280]) {
   await page.setViewportSize({width,height:900});
   const colors=[];
   for(const workspace of ['items','planner','insights']) {
    await page.locator(`[data-workspace="${workspace}"]`).click();
    colors.push(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   }
   expect(new Set(colors).size).toBe(1);
   for(const id of ['purchase-dialog','calendar-import-dialog','incoming-calendar-dialog','calendar-connect-dialog']) {
    await page.locator('#'+id).evaluate((d:HTMLDialogElement)=>d.showModal());
    expect(await page.locator('#'+id).evaluate(d=>d.scrollWidth<=d.clientWidth)).toBe(true);
    await page.locator('#'+id).evaluate((d:HTMLDialogElement)=>d.close());
   }
  }
  await page.locator('[data-workspace="items"]').click();
  await page.screenshot({path:`/tmp/tuckday-${theme}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`/tmp/tuckday-${theme}-phone.png`,fullPage:true});
  await page.locator('#new-purchase').click();await page.screenshot({path:`/tmp/tuckday-${theme}-modal.png`});
  await page.goto('/account');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/tmp/tuckday-${theme}-account.png`,fullPage:true});
 }
});
