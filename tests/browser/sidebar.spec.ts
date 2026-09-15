import {test,expect} from '@playwright/test';
test('sidebar preferences survive reload with accessible compact navigation and separate mobile layout',async({page})=>{
 await page.setViewportSize({width:1280,height:900});
 await page.goto('/'); await expect(page.locator('[data-workspace="items"]')).toBeEnabled();
 const toggle=page.locator('#sidebar-toggle');
 await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 await expect(page.locator('#planner-workspace')).toBeVisible();
 await page.reload(); await expect(toggle).toHaveAttribute('aria-expanded','false');
 await page.screenshot({path:'/tmp/tuckday-sidebar-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(toggle).toHaveAttribute('aria-expanded','true');
 await toggle.click(); await expect(page.locator('#sidebar-navigation')).toBeHidden();
 await page.reload(); await expect(toggle).toHaveAttribute('aria-expanded','false');
 await toggle.focus(); await page.keyboard.press('Enter');
 await expect(page.locator('#sidebar-navigation')).toBeVisible();
 await page.getByRole('button',{name:'Records',exact:true}).click();
 await page.locator('#search').fill('headphones');
 const geometry=await page.locator('.search-wrap').evaluate(el=>{
  const input=el.querySelector('input')!;const r=el.getBoundingClientRect(),i=input.getBoundingClientRect();
  return {outline:getComputedStyle(input).outlineStyle,contained:i.left>=r.left&&i.right<=r.right,overflow:document.documentElement.scrollWidth>innerWidth};
 });
 expect(geometry).toEqual({outline:'none',contained:true,overflow:false});
 await page.screenshot({path:'/tmp/tuckday-search-phone.png',fullPage:true});
 await page.setViewportSize({width:320,height:700});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});
 await expect(toggle).toHaveAttribute('aria-expanded','false');
});
