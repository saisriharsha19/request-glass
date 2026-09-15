import {test,expect} from 'bun:test';
import {findLinks} from '../../public/links.js';
test('calendar URLs support bare www, encoded queries and balanced parentheses while rejecting credentials',()=>{
 expect(findLinks("https://example.com/a_(b). www.example.org/room <a href='https://example.net/?a=1&amp;b=2'>join</a> javascript:alert(1) https://user:password@example.com/private")).toEqual(['https://example.com/a_(b)','https://www.example.org/room','https://example.net/?a=1&b=2']);
});
