import {test,expect} from '@playwright/test';
test('one form retains unsaved details, favorites and dates across close and reload without storing source text',async({page})=>{
 await page.setViewportSize({width:320,height:740});await page.goto('/');await page.locator('#new-purchase').click();
 await expect(page.locator('.capture-tabs')).toHaveCount(0);
 await page.locator('#item').fill('Draft appointment');await page.locator('#favorite').check();await page.locator('#category').selectOption('Health');await page.locator('#reminder').fill('2099-10-12');await page.locator('#receipt-text').fill('PRIVATE RAW SOURCE NOT FOR DRAFT STORAGE');
 await page.locator('#close-dialog').click();await page.locator('#new-purchase').click();await expect(page.locator('#item')).toHaveValue('Draft appointment');await expect(page.locator('#favorite')).toBeChecked();await expect(page.locator('#category')).toHaveValue('Health');
 await page.reload();await expect(page.locator('#purchase-dialog')).toBeVisible();await expect(page.locator('#reminder')).toHaveValue('2099-10-12');await expect(page.locator('#favorite')).toBeChecked();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('tuckday:drafts')).map(k=>sessionStorage.getItem(k)).join(''))).not.toContain('PRIVATE RAW SOURCE');
 await page.locator('#cancel-dialog').click();await page.locator('#new-purchase').click();await expect(page.locator('#item')).toHaveValue('');await expect(page.locator('#favorite')).not.toBeChecked();
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:740});await page.locator('#favorite').scrollIntoViewIfNeeded();await expect(page.getByText('Keep in favorites',{exact:true})).toBeVisible();const dims=await page.locator('#purchase-dialog').evaluate(d=>({scroll:d.scrollWidth,width:d.clientWidth}));expect(dims.scroll).toBe(dims.width);}
});
test('one AI click fills every supported form field while keeping manual edits',async({page})=>{
 let calls=0;const values={item:'Office monitor',category:'Electronics',reminderLabel:'Renew service',purchased:'2026-09-01',return:'2026-10-01',cancel:'2026-10-02',warranty:'2027-09-01',price:'2026-09-20',reminder:'2026-10-03'};
 await page.route('**/api/ai/extract',r=>{calls++;return r.fulfill({json:{fields:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,evidence:value}]))}});});
 await page.goto('/');await page.locator('#new-purchase').click();await page.locator('#merchant').fill('Keep my store');await page.locator('#receipt-text').fill('Synthetic source for form mapping');await page.locator('#ai-fill').click();await expect(page.locator('#ai-fill')).toBeEnabled();
 for(const [key,value] of Object.entries(values))await expect(page.locator('#'+key)).toHaveValue(value);await expect(page.locator('#merchant')).toHaveValue('Keep my store');expect(calls).toBe(1);
});

test('records, calendar, insights, account and all dialogs fit mobile and desktop layouts',async({page})=>{
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});await page.goto('/');await expect(page.locator('[data-workspace="items"]')).toBeEnabled();
  for(const workspace of ['items','planner','insights']){await page.locator(`[data-workspace="${workspace}"]`).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  for(const id of ['purchase-dialog','calendar-import-dialog','incoming-calendar-dialog','calendar-connect-dialog']){await page.evaluate(id=>(document.getElementById(id) as HTMLDialogElement).showModal(),id);const rect=await page.locator('#'+id).evaluate(d=>({left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right,width:d.clientWidth,scroll:d.scrollWidth}));expect(rect.left).toBeGreaterThanOrEqual(0);expect(rect.right).toBeLessThanOrEqual(width);expect(rect.scroll).toBe(rect.width);await page.locator('#'+id).evaluate(d=>(d as HTMLDialogElement).close());}
  await page.goto('/account');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.goto('/');await page.locator('[data-workspace="items"]').click();await page.locator('#new-purchase').click();await page.locator('#favorite').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/tuckday-form-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('#favorite').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/tuckday-form-phone.png'});
});

test('an unfinished account draft never opens for another account',async({page})=>{
 let user={id:'draft-alice',username:'alice',name:'Alice'};
 await page.route('**/api/auth/config',r=>r.fulfill({json:{configured:true}}));await page.route('**/api/auth/session',r=>r.fulfill({json:{user}}));await page.route('**/api/purchases',r=>r.fulfill({json:{purchases:[],revision:0,next:null}}));
 await page.goto('/');await page.locator('#new-purchase').click();await page.locator('#item').fill('Alice unfinished item');await page.locator('#close-dialog').click();
 user={id:'draft-bob',username:'bob',name:'Bob'};await page.reload();await expect(page.locator('#purchase-dialog')).toBeHidden();await page.locator('#new-purchase').click();await expect(page.locator('#item')).toHaveValue('');
});

test('a failed AI request retains its temporary page for retry',async({page,context})=>{
 const source=await context.newPage();await source.setContent('<p>Item: Laptop</p><p>Return by October 12, 2026</p>');const pdf=await source.pdf();await source.close();let calls=0;const imageCounts:number[]=[];
 await page.route('**/api/ai/extract',r=>{calls++;imageCounts.push(r.request().postDataJSON().images.length);return calls===1?r.fulfill({status:502,json:{error:'Temporary provider failure'}}):r.fulfill({json:{fields:{item:{value:'Laptop',evidence:'Item: Laptop'}}}});});
 await page.goto('/');await page.locator('#new-purchase').click();await page.locator('#receipt-file').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer:pdf});await expect(page.locator('#ocr-status')).toContainText('Read 1 PDF page');await page.locator('#ai-fill').click();await expect(page.locator('#ai-status')).toContainText('Temporary provider failure');await page.locator('#ai-fill').click();await expect(page.locator('#ai-fill')).toBeEnabled();expect(imageCounts).toEqual([1,1]);
});
