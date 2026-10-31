import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMarkdown } from '../markdown';

describe('escapeHtml', () => {
  it('转义会改变 HTML 结构的字符', () => {
    expect(escapeHtml('<script>"x"&\'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;'
    );
  });
});

describe('renderMarkdown', () => {
  it('LLM 返回的 HTML 不会被当成标签执行', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('二级标题渲染成带 md-h class 的标题', () => {
    const html = renderMarkdown('## 主推英雄');
    expect(html).toContain('<h3 class="md-h">主推英雄</h3>');
  });

  it('连续的列表项合成一个 ul', () => {
    const html = renderMarkdown('- 一\n- 二\n- 三');
    expect(html).toBe('<ul><li>一</li><li>二</li><li>三</li></ul>');
  });

  it('列表之外的段落独立成 p', () => {
    const html = renderMarkdown('第一段\n\n第二段');
    expect(html).toContain('<p>第一段</p>');
    expect(html).toContain('<p>第二段</p>');
  });

  it('行内粗体与代码', () => {
    const html = renderMarkdown('**重点** 和 `code`');
    expect(html).toContain('<strong>重点</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('围栏代码块整体转义', () => {
    const html = renderMarkdown('```\n<b>x</b>\n```');
    expect(html).toContain('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
  });

  it('空输入返回空串', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
