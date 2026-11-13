import { describe, expect, it } from 'vitest';
import {
  gameMapId,
  gameModeName,
  gameTitle,
  isAramGame,
  isAramMode,
  laneLabel,
  lcuGameModeLabel,
  lcuPhaseLabel,
  mapIdLabel,
  positionLabel,
  queueIdLabel,
  roleLabel
} from '../gameLabels';

describe('mapIdLabel', () => {
  it('召唤师峡谷和大乱斗认得', () => {
    expect(mapIdLabel(11)).toBe('召唤师峡谷');
    expect(mapIdLabel(12)).toBe('大乱斗');
  });

  it('认不出来的地图给空串', () => {
    expect(mapIdLabel(999)).toBe('');
    expect(mapIdLabel(0)).toBe('');
  });
});

describe('queueIdLabel', () => {
  it('排位队列有名字', () => {
    expect(queueIdLabel(420)).toBe('单双排');
    expect(queueIdLabel(400)).toBe('灵活排位');
  });

  it('2400 不给名字 —— 那是普通匹配,写出来没有信息量', () => {
    expect(queueIdLabel(2400)).toBe('');
  });

  it('认不出来的给空串', () => {
    expect(queueIdLabel(99999)).toBe('');
  });
});

describe('roleLabel / laneLabel', () => {
  it('定位有中文', () => {
    expect(roleLabel('SUPPORT')).toBe('辅助');
    expect(roleLabel('CARRY')).toBe('C 位');
  });

  it('认不出来的定位给空串', () => {
    expect(roleLabel('NONE')).toBe('');
  });

  it('分路有中文', () => {
    expect(laneLabel('MIDDLE')).toBe('中单');
    expect(laneLabel('JUNGLE')).toBe('打野');
  });
});

describe('gameTitle', () => {
  it('地图认不出就退回队列名', () => {
    expect(gameTitle(999, 420)).toBe('单双排');
  });

  it('地图和队列同名就只显示一次', () => {
    expect(gameTitle(12, 450)).toBe('大乱斗');
  });

  it('地图和队列不同就两个都显示', () => {
    expect(gameTitle(11, 420)).toBe('召唤师峡谷 · 单双排');
  });

  it('大乱斗的普通匹配就只显示地图名', () => {
    expect(gameTitle(12, 2400)).toBe('大乱斗');
  });
});

describe('positionLabel', () => {
  it('召唤师峡谷看分路', () => {
    expect(positionLabel(11, 'MIDDLE', 'NONE')).toBe('中单');
  });

  it('召唤师峡谷里打辅助的一律显示辅助', () => {
    expect(positionLabel(11, 'BOTTOM', 'SUPPORT')).toBe('辅助');
  });

  it('大乱斗不显示位置 —— 那边没有上下路,写了也是误导', () => {
    expect(positionLabel(12, 'BOTTOM', 'SUPPORT')).toBe('');
    expect(positionLabel(12, 'MIDDLE', 'CARRY')).toBe('');
    expect(positionLabel(12, 'MIDDLE', 'NONE')).toBe('');
  });

  it('召唤师峡谷里分路认不出来就退回定位', () => {
    expect(positionLabel(11, '', 'CARRY')).toBe('射手');
    expect(positionLabel(11, '', 'SOLO')).toBe('中单');
  });

  it('位置认不出来就不显示 —— 不写个可能错的', () => {
    expect(positionLabel(11, '', 'NONE')).toBe('');
    expect(positionLabel(11, '', 'DUO')).toBe('');
  });
});

describe('lcuPhaseLabel', () => {
  it('对局中的阶段认得', () => {
    expect(lcuPhaseLabel('InProgress')).toBe('对局中');
    expect(lcuPhaseLabel('EndOfGame')).toBe('对局结束');
  });

  it('认不出来的阶段给空串', () => {
    expect(lcuPhaseLabel('SomethingNew')).toBe('');
  });
});

describe('lcuGameModeLabel / isAramMode', () => {
  it('客户端的模式串认得', () => {
    expect(lcuGameModeLabel('CLASSIC')).toBe('召唤师峡谷');
    expect(lcuGameModeLabel('ARAM')).toBe('大乱斗');
  });

  it('认不出来的模式给空串', () => {
    expect(lcuGameModeLabel('TUTORIAL')).toBe('');
  });

  it('只有大乱斗算大乱斗', () => {
    expect(isAramMode('ARAM')).toBe(true);
    expect(isAramMode('aram')).toBe(true);
    expect(isAramMode('CLASSIC')).toBe(false);
  });
});

describe('isAramGame', () => {
  it('认地图 —— 腾讯的 gameMode 恒是 KIWI,不能拿它当判据', () => {
    expect(isAramGame({ mapId: 12, queueId: 0, gameMode: 'KIWI' })).toBe(true);
    expect(isAramGame({ mapId: 11, queueId: 420, gameMode: 'KIWI' })).toBe(false);
  });

  it('没有地图号就退到队列号', () => {
    expect(isAramGame({ mapId: 0, queueId: 450, gameMode: 'KIWI' })).toBe(true);
    expect(isAramGame({ mapId: 0, queueId: 420, gameMode: 'KIWI' })).toBe(false);
  });

  it('客户端直接给 ARAM 也认', () => {
    expect(isAramGame({ mapId: 0, queueId: 0, gameMode: 'ARAM' })).toBe(true);
    expect(isAramGame({ mapId: 0, queueId: 0, gameMode: 'KIWI', queueType: 'ARAM' })).toBe(true);
  });
});

describe('gameMapId', () => {
  it('有地图号就信地图号', () => {
    expect(gameMapId({ mapId: 12, queueId: 0, gameMode: 'KIWI' })).toBe(12);
    expect(gameMapId({ mapId: 11, queueId: 450, gameMode: 'KIWI' })).toBe(11);
  });

  it('没地图号就用队列号反推', () => {
    expect(gameMapId({ mapId: 0, queueId: 450, gameMode: 'KIWI' })).toBe(12);
    expect(gameMapId({ mapId: 0, queueId: 420, gameMode: 'KIWI' })).toBe(11);
  });

  it('认不出来就是 0 —— 不猜', () => {
    expect(gameMapId({ mapId: 0, queueId: 0, gameMode: 'KIWI' })).toBe(0);
    expect(gameMapId({ mapId: 0, queueId: 0, gameMode: '' })).toBe(0);
  });
});

describe('gameModeName', () => {
  it('召唤师峡谷带队列名', () => {
    expect(gameModeName({ mapId: 11, queueId: 420, gameMode: 'KIWI' })).toBe('召唤师峡谷 · 单双排');
  });

  it('大乱斗只有一个名字', () => {
    expect(gameModeName({ mapId: 12, queueId: 450, gameMode: 'KIWI' })).toBe('大乱斗');
  });

  it('认不出来就空着', () => {
    expect(gameModeName({ mapId: 0, queueId: 0, gameMode: 'KIWI' })).toBe('');
  });
});
