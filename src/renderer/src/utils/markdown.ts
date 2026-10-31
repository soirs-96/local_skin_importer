/**
 * 极简 Markdown 渲染。
 *
 * 只给 AI 推荐用。LLM 的输出被模板约束成「五个二级标题 + 若干列表项」,
 * 不需要完整的 CommonMark。
 *
 * **为什么自己写而不是引 marked**:少一个依赖是一层理由,更重要的是安全 ——
 * 这里先把所有文本做 HTML 转义,再套标签,LLM 返回的东西里就算带了
 * `<script>` 也只会变成字面量,不会执行。
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** 行内标记:**粗体** 与 `代码`。输入必须已经转义过。 */
function renderInline(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(source: string): string {
  const lines = (source ?? '').split(/\r?\n/);
  const html: string[] = [];

  let listBuffer: string[] = [];
  let paragraphBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;

  const flushList = (): void => {
    if (listBuffer.length > 0) {
      html.push(`<ul>${listBuffer.join('')}</ul>`);
      listBuffer = [];
    }
  };
  const flushParagraph = (): void => {
    if (paragraphBuffer.length > 0) {
      html.push(`<p>${paragraphBuffer.join('<br/>')}</p>`);
      paragraphBuffer = [];
    }
  };
  const flushBlocks = (): void => {
    flushList();
    flushParagraph();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith('```')) {
      flushBlocks();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushBlocks();
      // 「## 主推英雄」这种二级标题映射成 h3,让 h2 留给文档标题
      const level = Math.min(Math.max(heading[1].length + 1, 2), 5);
      html.push(`<h${level} class="md-h">${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^\s*[-*+]\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      listBuffer.push(`<li>${renderInline(escapeHtml(listItem[1]))}</li>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushBlocks();
      html.push(`<blockquote>${renderInline(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      flushBlocks();
      continue;
    }

    flushList();
    paragraphBuffer.push(renderInline(escapeHtml(line.trim())));
  }

  if (inCode && codeBuffer.length > 0) {
    html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  }
  flushBlocks();

  return html.join('');
}
