import { describe, expect, it } from 'vitest';
import {
  buildChampionIndex,
  matchChampion,
  normalizeChampionName,
  parseRecommendation
} from '../recommendation';

/** AI 正常返回的那份 —— 五个固定小节。 */
const SAMPLE = [
  '## 主推英雄',
  '- 千珏',
  '- 佛耶戈',
  '',
  '## 备选英雄',
  '- 盲僧',
  '',
  '## 核心天赋',
  '- 强攻系',
  '- 致命节奏',
  '',
  '## 出装思路',
  '- 风暴聚合',
  '- 中娅沙漏',
  '',
  '## 思路说明',
  '对方有阿卡丽,需要位移或者稳定控制。'
].join('\n');

describe('parseRecommendation', () => {
  it('五个小节各占一块', () => {
    const parsed = parseRecommendation(SAMPLE);
    expect(parsed.sections.map((s) => s.title)).toEqual([
      '主推英雄',
      '备选英雄',
      '核心天赋',
      '出装思路',
      '思路说明'
    ]);
  });

  it('英雄段和清单段分开记', () => {
    const parsed = parseRecommendation(SAMPLE);
    expect(parsed.sections[0].kind).toBe('champions');
    expect(parsed.sections[0].items).toEqual(['千珏', '佛耶戈']);
    expect(parsed.sections[2].kind).toBe('items');
    expect(parsed.sections[2].items).toEqual(['强攻系', '致命节奏']);
  });

  it('正文段落归到文字里', () => {
    const parsed = parseRecommendation(SAMPLE);
    expect(parsed.sections[4].kind).toBe('text');
    expect(parsed.sections[4].text).toContain('阿卡丽');
  });

  it('列表项里的 markdown 强调去掉 —— 面板上摆的是纯文本', () => {
    const parsed = parseRecommendation('## 主推英雄\n- **千珏**\n- `佛耶戈`');
    expect(parsed.sections[0].items).toEqual(['千珏', '佛耶戈']);
  });

  it('降级模式也拆得开 —— 认不出的标题按结构定类型', () => {
    const parsed = parseRecommendation(
      ['# 推荐(降级模式)', '⚠️ LLM 响应不完整', '', '## 我方', '- 安妮 (位置:中单)'].join('\n')
    );
    expect(parsed.title).toBe('推荐(降级模式)');
    expect(parsed.preamble).toContain('LLM 响应不完整');
    expect(parsed.sections[0].title).toBe('我方');
    expect(parsed.sections[0].kind).toBe('items');
    expect(parsed.sections[0].items).toEqual(['安妮 (位置:中单)']);
  });

  it('空输入不炸', () => {
    const parsed = parseRecommendation('');
    expect(parsed.sections).toEqual([]);
    expect(parsed.title).toBe('');
  });

  it('标题多两个字也认得 —— AI 常写成「主推英雄推荐」', () => {
    const parsed = parseRecommendation('## 主推英雄推荐\n- 千珏');
    expect(parsed.sections[0].kind).toBe('champions');
  });

  it('段标题写成三级标题也认得', () => {
    const parsed = parseRecommendation('### 备选英雄\n- 蔚');
    expect(parsed.sections[0].title).toBe('备选英雄');
    expect(parsed.sections[0].kind).toBe('champions');
  });
});

describe('normalizeChampionName', () => {
  it('撇号和空格都不算数 —— 同一个英雄归到同一个键', () => {
    expect(normalizeChampionName("Kai'Sa")).toBe('kaisa');
    expect(normalizeChampionName('Kai Sa')).toBe('kaisa');
    expect(normalizeChampionName('凯南')).toBe('凯南');
  });
});

describe('buildChampionIndex / matchChampion', () => {
  const index = buildChampionIndex([
    { id: 222, name: '千珏' },
    { id: 111, name: '蔚', nameEn: 'Nautilus' },
    { id: 266, name: '虚空恐惧', nameEn: "Vel'Koz" }
  ]);

  it('中文名认得', () => {
    expect(matchChampion('千珏', index)).toEqual({ id: 222, name: '千珏', note: '' });
  });

  it('英文名也认 —— AI 偶尔写英文', () => {
    expect(matchChampion('Nautilus', index)?.id).toBe(111);
    expect(matchChampion('velkoz', index)?.id).toBe(266);
  });

  it('名字后面带说明时,说明摘出来', () => {
    const hit = matchChampion('千珏(主攻)', index);
    expect(hit?.name).toBe('千珏');
    expect(hit?.note).toBe('(主攻)');
  });

  it('认不出来就 null —— 不硬套一个头像', () => {
    expect(matchChampion('盲僧', index)).toBeNull();
  });

  it('对照表是空的时候也认不出来', () => {
    expect(matchChampion('千珏', new Map())).toBeNull();
  });
});
