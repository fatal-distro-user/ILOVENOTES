import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('sticky markdown', () => {
  it('renders common syntax and escapes html', () => {
    const h = renderMarkdown('# Title\n**bold** *it* `code`\n- [x] done\n- item\n1. one\n<script>x</script>');
    expect(h).toContain('<h1>Title</h1>');
    expect(h).toContain('<strong>bold</strong> <em>it</em> <code>code</code>');
    expect(h).toContain('<input type="checkbox" disabled checked> done');
    expect(h).toContain('<ol><li>one</li></ol>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).not.toContain('<script>');
  });
});
