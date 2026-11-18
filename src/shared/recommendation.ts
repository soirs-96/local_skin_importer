/**
 * AI 推荐的内容拆段 + 英雄名对照。
 *
 * LLM 的输出被模板约束成「五个二级标题 + 若干列表项」(见
 * main/match/recommender.ts)。界面不该把这一整段当一条流往下拉 ——
 * 拆成块,每块自己一个面板,一眼扫得完。
 *
 * 纯函数,不碰 Electron —— 主进程和渲染进程共用一份。
 */

/** 一段的类型。 */
export type RecommendationSectionKind = 'champions' | 'items' | 'text';

/** 一段推荐。 */
export interface RecommendationSection {
  /** 段标题(去掉 `## ` 的原文) */
  title: string;
  kind: RecommendationSectionKind;
  /** 列表项(去掉 `- ` 后的正文,已去掉 markdown 强调);没有就是空数组 */
  items: string[];
  /** 正文段落;没有就是空串 */
  text: string;
}

/** 拆完的整份推荐。 */
export interface ParsedRecommendation {
  /** 文档标题(`# ` 那行);没有就空串 */
  title: string;
  /** 第一段标题之前的正文(降级模式那行 ⚠️ 提示) */
  preamble: string;
  sections: RecommendationSection[];
}

/**
 * 模板里那五段的类型。
 *
 * 标题认得出来就按它定 —— 认不出来的(降级模式的「我方」「敌方」)才看结构。
 */
const SECTION_KINDS: Record<string, RecommendationSectionKind> = {
  主推英雄: 'champions',
  备选英雄: 'champions',
  核心天赋: 'items',
  出装思路: 'items',
  思路说明: 'text'
};

/**
 * 标题认得出来是哪一段 —— 认不出返回 undefined。
 *
 * 先精确匹配,再退到「包含」—— AI 常写成「主推英雄推荐」「### 备选英雄」
 * 这种,死抠五个字就认不出来了。
 */
function knownSectionKind(title: string): RecommendationSectionKind | undefined {
  const exact = SECTION_KINDS[title];
  if (exact) return exact;
  for (const [key, kind] of Object.entries(SECTION_KINDS)) {
    if (title.includes(key)) return kind;
  }
  return undefined;
}

/** 一段是哪种类型。标题认不出来就看结构 —— 有条目就是清单,没条目就是正文。 */
function sectionKind(title: string, itemCount: number): RecommendationSectionKind {
  return knownSectionKind(title) ?? (itemCount > 0 ? 'items' : 'text');
}

/** 去掉列表项里的 markdown 强调 —— 面板上是纯文本,不用再渲染一遍。 */
function cleanItem(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

/**
 * 把一份推荐拆成若干段。
 *
 * 认得的结构:`# 标题`、`## 段标题`、`- 列表项`、正文。
 * 认不出来的行当作正文 —— 宁可多显示一行,别把内容吞了。
 */
export function parseRecommendation(markdown: string): ParsedRecommendation {
  const lines = (markdown ?? '').split(/\r?\n/);
  let title = '';
  const preambleLines: string[] = [];
  const sections: RecommendationSection[] = [];
  let current: RecommendationSection | null = null;

  const pushCurrent = (): void => {
    if (!current) return;
    current.text = current.text.trim();
    current.kind = sectionKind(current.title, current.items.length);
    sections.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level === 1) {
        // 文档标题 —— 降级模式那行是「# 推荐(降级模式)」
        if (!title) {
          title = text;
          continue;
        }
      } else if (level === 2 || knownSectionKind(text) !== undefined) {
        // 二级标题是段开头;三级标题认得出来是哪一段时也算 ——
        // AI 偶尔把段标题写成 h3。
        pushCurrent();
        current = { title: text, kind: 'items', items: [], text: '' };
        continue;
      }
      // 其它级别的标题当正文看
      if (current) current.text += `${text}\n`;
      else preambleLines.push(text);
      continue;
    }

    const listItem = line.match(/^[-*+]\s+(.*)$/);
    if (listItem) {
      const item = cleanItem(listItem[1]);
      if (!item) continue;
      if (current) current.items.push(item);
      else preambleLines.push(item);
      continue;
    }

    if (current) current.text += `${line}\n`;
    else preambleLines.push(line);
  }

  pushCurrent();

  return { title, preamble: preambleLines.join('\n').trim(), sections };
}

/* -------------------------------------------------------------------------- */
/*                                英雄名对照                                    */
/* -------------------------------------------------------------------------- */

/** 对照表里的一条英雄。 */
export interface ChampionIndexEntry {
  id: number;
  /** 中文名 */
  name: string;
  /** 英文名;没有就空 */
  nameEn?: string;
}

/** 名字 → 英雄。键是规范化过的名字。 */
export type ChampionIndex = Map<string, ChampionIndexEntry>;

/**
 * 名字规范化 —— 拿去当对照表的键。
 *
 * 只保留字母、数字和汉字,其余(空格、撇号、点、括号)全去掉:
 * `Kai'Sa` / `Kai Sa` / `kaisa` 得归到同一个键上。
 */
export function normalizeChampionName(name: string): string {
  return (name ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** 建对照表 —— 中文名和英文名都收进去。 */
export function buildChampionIndex(entries: ChampionIndexEntry[]): ChampionIndex {
  const index: ChampionIndex = new Map();
  for (const entry of entries) {
    if (!Number.isInteger(entry.id) || entry.id <= 0) continue;
    for (const name of [entry.name, entry.nameEn]) {
      if (!name) continue;
      const key = normalizeChampionName(name);
      if (!key || index.has(key)) continue;
      index.set(key, entry);
    }
  }
  return index;
}

/** 认出来的英雄。 */
export interface ChampionMatch {
  id: number;
  /** 标签里认出来的那段英雄名(照抄 AI 写的,不换成库里的名字) */
  name: string;
  /** 名字之外的说明,比如「(主攻)」;没有就空串 */
  note: string;
}

/**
 * 分隔符 —— 名字和说明之间的那些东西。
 *
 * 括号、冒号、顿号、逗号、空格、斜杠这一类。**撇号不算** ——
 * `Kai'Sa` 是一个名字,不能从中间切开。
 */
const SEPARATORS = new Set([
  '(',
  ')',
  '（',
  '）',
  '[',
  ']',
  '【',
  '】',
  '{',
  '}',
  ':',
  '：',
  '、',
  ',',
  '，',
  ' ',
  '\t',
  '/',
  '·',
  '—',
  '-',
  '~',
  '|'
]);

/**
 * 从一段文字里认出英雄。
 *
 * AI 给的通常是纯名字,但也常带一句说明 —— 「千珏(主攻)」。
 * 先按整段试,不行就按分隔符切成几段,一段一段试;认出来的那段当英雄名,
 * 剩下的当说明。
 *
 * 认不出来就返回 null —— 界面退回纯文字,不硬套一个头像。
 */
export function matchChampion(label: string, index: ChampionIndex): ChampionMatch | null {
  const text = cleanItem(label);
  if (!text || index.size === 0) return null;

  const whole = index.get(normalizeChampionName(text));
  if (whole) return { id: whole.id, name: text, note: '' };

  const segments: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!SEPARATORS.has(text[i])) continue;
    if (i > start) segments.push({ text: text.slice(start, i), start, end: i });
    start = i + 1;
  }
  if (start < text.length) segments.push({ text: text.slice(start), start, end: text.length });

  for (const segment of segments) {
    const hit = index.get(normalizeChampionName(segment.text));
    if (!hit) continue;
    const before = text.slice(0, segment.start).trim();
    const after = text.slice(segment.end).trim();
    const note = [before, after].filter(Boolean).join(' ');
    return { id: hit.id, name: segment.text, note };
  }
  return null;
}
