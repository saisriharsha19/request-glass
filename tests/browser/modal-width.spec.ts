import {test,expect} from '@playwright/test';
for(const engine of ['chromium'])test(`${engine}: every dialog contains its content while typing on a phone`,async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3210',viewport:{width:320,height:740},isMobile:true,hasTouch:true});
 const page=await context.newPage();await page.goto('/');
 await expect(page.locator('[data-workspace="planner"]')).toBeEnabled();
 for(const width of [320,375,390]) {
  await page.setViewportSize({width,height:740});
  for(const id of ['purchase-dialog','calendar-import-dialog','incoming-calendar-dialog','calendar-connect-dialog']) {
   await page.evaluate(id=>{const d=document.getElementById(id) as HTMLDialogElement;d.showModal();},id);
   const dialog=page.locator('#'+id);
   if(id==='purchase-dialog') {
    await page.locator('button[data-method="manual"]').click();
    expect(await page.evaluate(()=>document.activeElement?.id)).not.toBe('item');
    await page.locator('button[data-method="paste"]').click();
    await page.locator('#item').fill('Very long purchase title '.repeat(7));
    await page.locator('#notes').fill('https://example.com/'+ 'long-reference'.repeat(70));
    await page.locator('#return').fill('2027-12-31');
   }
   if(id==='incoming-calendar-dialog')await page.locator('#incoming-title').evaluate(e=>e.textContent='ConnectedCalendars'.repeat(12));
   const check=async()=>{
    const size=await dialog.evaluate(d=>({width:d.clientWidth,scroll:d.scrollWidth,left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right,overflow:[...d.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&& (r.right>d.getBoundingClientRect().right+1||r.left<d.getBoundingClientRect().left-1);}).map(e=>e.id||e.className||e.tagName)}));
    expect(size.overflow,`${id} at ${width}: overflowing children`).toEqual([]);
    expect(size.scroll,`${id}: scroll width`).toBeLessThanOrEqual(size.width+1);
    expect(size.left).toBeGreaterThanOrEqual(0);expect(size.right).toBeLessThanOrEqual(width+1);
   };
   await check();await page.setViewportSize({width,height:420});await check();
   await dialog.evaluate(d=>{d.scrollLeft=100;});expect(await dialog.evaluate(d=>d.scrollLeft)).toBe(0);
   await page.setViewportSize({width,height:740});await dialog.evaluate(d=>(d as HTMLDialogElement).close());
  }
 }
 await context.close();
});
