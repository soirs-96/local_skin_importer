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
  positionFromRoleQuest,
  positionLabel,
  queueIdLabel,
  queueNameLabel,
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

  it('440 是灵活排位 —— 实测国服客户端的战绩里 440 是灵活组排', () => {
    expect(queueIdLabel(440)).toBe('灵活排位');
  });

  it('2400 不给名字 —— 那是普通匹配,写出来没有信息量', () => {
    expect(queueIdLabel(2400)).toBe('');
  });

  it('认不出来的给空串', () => {
    expect(queueIdLabel(99999)).toBe('');
  });
});

describe('queueNameLabel', () => {
  it('认得出队列串就认队列串 —— 队列号在国服和国际服不是一套编号', () => {
    expect(queueNameLabel({ mapId: 11, queueId: 440, gameMode: 'KIWI', queueType: 'RANKED_FLEX_SR' })).toBe(
      '灵活排位'
    );
    expect(
      queueNameLabel({ mapId: 11, queueId: 440, gameMode: 'KIWI', queueType: 'RANKED_FLEX_5x5' })
    ).toBe('灵活排位');
  });

  it('队列串跟队列号冲突时以队列串为准', () => {
    expect(
      queueNameLabel({ mapId: 11, queueId: 420, gameMode: 'KIWI', queueType: 'RANKED_FLEX_SR' })
    ).toBe('灵活排位');
  });

  it('普通匹配的队列串不显示 —— 没有信息量', () => {
    expect(queueNameLabel({ mapId: 11, queueId: 2400, gameMode: 'KIWI', queueType: 'CLASSIC' })).toBe('');
  });

  it('没有队列串就退回队列号', () => {
    expect(queueNameLabel({ mapId: 11, queueId: 420, gameMode: 'KIWI' })).toBe('单双排');
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

  it('给了队列串就以队列串为准', () => {
    expect(gameTitle(11, 440, 'RANKED_FLEX_SR')).toBe('召唤师峡谷 · 灵活排位');
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
  });

  it('角色任务道具最优先 —— 实测打野那局 lane 空、role 写成 SUPPORT,靠它救回来', () => {
    expect(positionLabel(11, 'NONE', 'SUPPORT', '打野任务')).toBe('打野');
    expect(positionLabel(11, 'NONE', 'SUPPORT', '打野任务奖励')).toBe('打野');
    expect(positionLabel(11, 'BOTTOM', 'SUPPORT', '辅助任务奖励')).toBe('辅助');
    expect(positionLabel(11, 'JUNGLE', 'NONE', '上路任务奖励')).toBe('上单');
  });

  it('定位优先于分路 —— 射手那局 lane 写的是 TOP,得听 role 的', () => {
    expect(positionLabel(11, 'TOP', 'DUO')).toBe('射手');
  });
});

describe('下路那两个人(射手 / 辅助)', () => {
  /** 一局辅助的样子:助攻多、补刀少。 */
  const support = {
    kills: 3,
    assists: 31,
    deaths: 4,
    minionKills: 45,
    gameMaxMinionKills: 220
  };

  /** 一局射手的样子:吃线、人头多。 */
  const adc = {
    kills: 12,
    assists: 5,
    deaths: 3,
    minionKills: 205,
    gameMaxMinionKills: 220
  };

  it('「下路任务」说的是分路 —— 辅助那局不能判成射手', () => {
    expect(positionLabel(11, 'BOTTOM', 'NONE', '下路任务', support)).toBe('辅助');
  });

  it('定位写着辅助就认辅助 —— 不管任务道具给的是什么', () => {
    expect(positionLabel(11, 'BOTTOM', 'SUPPORT', '下路任务')).toBe('辅助');
  });

  it('定位写错了就听数据的 —— 补刀到全场最高的三分之二,那是在吃线,是射手', () => {
    const farmer = { kills: 10, assists: 6, deaths: 2, minionKills: 200, gameMaxMinionKills: 210 };
    expect(positionLabel(11, 'BOTTOM', 'SUPPORT', '下路任务', farmer)).toBe('射手');
  });

  it('真的是射手就还是射手', () => {
    expect(positionLabel(11, 'BOTTOM', 'CARRY', '下路任务', adc)).toBe('射手');
  });

  it('没有任务道具、定位写 DUO 时也按数据分一次', () => {
    expect(positionLabel(11, 'BOTTOM', 'DUO', '', support)).toBe('辅助');
    expect(positionLabel(11, 'BOTTOM', 'DUO', '', adc)).toBe('射手');
  });

  it('没有补刀数据就靠助攻硬扛 —— 二十个助攻才肯改判', () => {
    const noCs = { kills: 3, assists: 31, deaths: 4, minionKills: 0, gameMaxMinionKills: 0 };
    expect(positionLabel(11, 'BOTTOM', 'NONE', '下路任务', noCs)).toBe('辅助');

    // 助攻不够多 —— 射手崩了也有十来个助攻,不能凭这个改判
    const notEnough = { kills: 5, assists: 14, deaths: 6, minionKills: 0, gameMaxMinionKills: 0 };
    expect(positionLabel(11, 'BOTTOM', 'NONE', '下路任务', notEnough)).toBe('射手');
  });
});

describe('positionFromRoleQuest', () => {
  it('中文任务道具认得', () => {
    expect(positionFromRoleQuest('打野任务')).toBe('JUNGLE');
    expect(positionFromRoleQuest('打野任务奖励')).toBe('JUNGLE');
    expect(positionFromRoleQuest('上路任务')).toBe('TOP');
    expect(positionFromRoleQuest('中路任务奖励')).toBe('MID');
    expect(positionFromRoleQuest('下路任务')).toBe('ADC');
    expect(positionFromRoleQuest('辅助任务')).toBe('SUPPORT');
  });

  it('英文任务道具也认', () => {
    expect(positionFromRoleQuest('Jungle Role Quest')).toBe('JUNGLE');
    expect(positionFromRoleQuest('Support Role Quest')).toBe('SUPPORT');
  });

  it('不是任务道具就认不出来', () => {
    expect(positionFromRoleQuest('鞋子')).toBe('UNKNOWN');
    expect(positionFromRoleQuest('轻灵之靴')).toBe('UNKNOWN');
    expect(positionFromRoleQuest('控制守卫')).toBe('UNKNOWN');
    expect(positionFromRoleQuest('')).toBe('UNKNOWN');
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

  it('队列串优先 —— 一局灵活组排不该被说成单双排', () => {
    expect(
      gameModeName({ mapId: 11, queueId: 440, gameMode: 'KIWI', queueType: 'RANKED_FLEX_SR' })
    ).toBe('召唤师峡谷 · 灵活排位');
  });

  it('大乱斗只有一个名字', () => {
    expect(gameModeName({ mapId: 12, queueId: 450, gameMode: 'KIWI' })).toBe('大乱斗');
  });

  it('认不出来就空着', () => {
    expect(gameModeName({ mapId: 0, queueId: 0, gameMode: 'KIWI' })).toBe('');
  });
});
