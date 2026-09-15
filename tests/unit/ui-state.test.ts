import {test,expect} from 'bun:test';
import {cleanState} from '../../public/ui-state.js';
test('view state validates persisted values and excludes drafts and credentials',()=>{
 const result=cleanState({workspace:'unknown',query:'x'.repeat(400),limit:999999,calendar:{month:'bad',selected:'2026-02-31',filter:'bad'},password:'secret',receipt:'private',scroll:{items:Infinity}});
 expect(result.workspace).toBe('items');expect(result.query.length).toBe(300);expect(result.limit).toBe(3000);expect(result.calendar.month).toBe('');expect(result.calendar.selected).toBe('');expect(result).not.toHaveProperty('password');expect(result).not.toHaveProperty('receipt');
});
