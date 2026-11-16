import { describe, expect, it } from 'vitest';
import {
  decideAccept,
  findMyMember,
  phaseLabel,
  statusLabel,
  type AcceptProbe
} from '../autoAccept';

const MY_PUUID = 'puuid-me';

function probe(overrides: Partial<AcceptProbe> = {}): AcceptProbe {
  return {
    phase: 'ChampSelect',
    localPlayerCellId: 0,
    myPuuid: MY_PUUID,
    myTeam: [
      { cellId: 0, puuid: MY_PUUID, championId: 64 },
      { cellId: 1, puuid: 'puuid-ally', championId: 0 }
    ],
    ...overrides
  };
}

describe('findMyMember', () => {
  it('按格位认人', () => {
    const me = findMyMember(probe({ localPlayerCellId: 1, myPuuid: '' }));
    expect(me?.puuid).toBe('puuid-ally');
  });

  it('格位认不出就按 puuid 认', () => {
    const me = findMyMember(probe({ localPlayerCellId: -1 }));
    expect(me?.championId).toBe(64);
  });

  it('两个都认不出就当没有 —— 不能认错人', () => {
    const me = findMyMember(probe({ localPlayerCellId: -1, myPuuid: 'puuid-not-me' }));
    expect(me).toBeNull();
  });
});

describe('decideAccept', () => {
  it('匹配成功后的弹窗(ready check)直接接受', () => {
    expect(decideAccept(probe({ phase: 'ReadyCheck' }))).toBe('ready-check');
  });

  it('选人阶段锁定英雄后接受', () => {
    expect(decideAccept(probe())).toBe('champ-select');
  });

  it('还没锁定英雄不动 —— 客户端的确认按钮是灰的', () => {
    const p = probe({
      myTeam: [
        { cellId: 0, puuid: MY_PUUID, championId: 0 },
        { cellId: 1, puuid: 'puuid-ally', championId: 64 }
      ]
    });
    expect(decideAccept(p)).toBe('none');
  });

  it('认不出自己就不动', () => {
    const p = probe({ localPlayerCellId: -1, myPuuid: 'puuid-not-me' });
    expect(decideAccept(p)).toBe('none');
  });

  it('不在对局里就不动', () => {
    expect(decideAccept(probe({ phase: 'Lobby' }))).toBe('none');
    expect(decideAccept(probe({ phase: 'InProgress' }))).toBe('none');
    expect(decideAccept(probe({ phase: '' }))).toBe('none');
  });
});

describe('文案', () => {
  it('状态有中文名', () => {
    expect(statusLabel('off')).toBe('未开启');
    expect(statusLabel('accepted')).toBe('已接受');
  });

  it('阶段有中文名', () => {
    expect(phaseLabel('ChampSelect')).toBe('英雄选择');
    expect(phaseLabel('ReadyCheck')).toBe('等待接受');
    expect(phaseLabel('')).toBe('未进入');
  });
});
