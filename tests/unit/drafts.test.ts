import {test,expect} from 'bun:test';
import {draftValues} from '../../public/drafts.js';
test('drafts keep bounded editable fields and exclude source files and text',()=>{
 const values=draftValues({item:'x'.repeat(500),category:'Electronics',favorite:true,text:'raw receipt',image:'data:image/jpeg;base64,secret',password:'secret',notes:'Reviewed note'});
 expect(values.item).toHaveLength(180);expect(values.favorite).toBe(true);expect(values.notes).toBe('Reviewed note');expect(values).not.toHaveProperty('text');expect(values).not.toHaveProperty('image');expect(values).not.toHaveProperty('password');
});
