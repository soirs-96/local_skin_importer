import { describe, expect, it } from 'vitest';
import {
  LOBBY_HISTORY_LIMIT,
  LOBBY_TEXT_MAX_LEN,
  appendMessages,
  isLobbyInvitable,
  lobbyLastSeenText,
  lobbyPlayerName,
  lobbyPlayerPositions,
  lobbyStatusOf,
  lobbyStatusText,
  mergeMessages
} from '../lobby';
import type { LobbyMessage, LobbyPlayer } from '../lobby';

function player(over: Partial<LobbyPlayer> = {}): LobbyPlayer {
  return {
    userId: 1,
    nickname: '林俊杰',
    gameId: '18557',
    zone: '艾欧尼亚',
    canonicalZone: '艾欧尼亚',
    avatarUrl: '',
    phase: 'None',
    online: true,
    publicVisible: true,
    rankScore: 32000,
    rankLabel: '黄金 III',
    collectionScore: 520,
    positions: ['mid'],
    positionLabels: ['中单'],
    vip: false,
    lastLobbyAt: null,
    ...over
  };
}

function message(id: number, text: string): LobbyMessage {
  return {
    id,
    userId: 7,
    nickname: '林俊杰',
    gameId: '18557',
    zone: '艾欧尼亚',
    text,
    createdAt: '2026-11-24 22:16:03'
  };
}

describe('lobbyStatusOf', () => {
  it('空闲和大厅都算「能拉」', () => {
    expect(lobbyStatusOf('None')).toBe('idle');
    expect(lobbyStatusOf('Lobby')).toBe('idle');
  });

  it('在打 anything 都算「忙」', () => {
    for (const phase of ['ChampSelect', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame', 'PostGame']) {
      expect(lobbyStatusOf(phase)).toBe('busy');
    }
  });

  it('认不出来的阶段一律「未知」—— 不猜', () => {
    expect(lobbyStatusOf('')).toBe('unknown');
    expect(lobbyStatusOf('SomethingNew')).toBe('unknown');
  });
});

describe('lobbyStatusText', () => {
  it('复用对局页那份 phase → 中文映射', () => {
    expect(lobbyStatusText('InProgress')).toBe('对局中');
    expect(lobbyStatusText('None')).toBe('空闲');
  });

  it('认不出来就说「未知」', () => {
    expect(lobbyStatusText('')).toBe('未知');
    expect(lobbyStatusText('Nope')).toBe('未知');
  });
});

describe('isLobbyInvitable', () => {
  it('空闲 + 有游戏ID → 能拉', () => {
    expect(isLobbyInvitable(player())).toBe(true);
  });

  it('在打游戏 → 不能拉', () => {
    expect(isLobbyInvitable(player({ phase: 'InProgress' }))).toBe(false);
  });

  it('状态未知 → 不能拉(不猜)', () => {
    expect(isLobbyInvitable(player({ phase: '' }))).toBe(false);
  });

  it('没有游戏ID → 不能拉(邀不了)', () => {
    expect(isLobbyInvitable(player({ gameId: '' }))).toBe(false);
  });
});

describe('lobbyPlayerName', () => {
  it('昵称优先', () => {
    expect(lobbyPlayerName(player())).toBe('林俊杰');
  });

  it('没昵称退回游戏ID', () => {
    expect(lobbyPlayerName(player({ nickname: '', gameId: '84174' }))).toBe('84174');
  });

  it('两个都没有就换个说法', () => {
    expect(lobbyPlayerName(player({ nickname: '', gameId: '' }))).toBe('无名召唤师');
  });
});

describe('lobbyPlayerPositions', () => {
  it('返回上报的历史位置', () => {
    const positions = lobbyPlayerPositions(
      player({ positions: ['jungle'], positionLabels: ['打野'] })
    );
    expect(positions.codes).toEqual(['jungle']);
    expect(positions.labels).toEqual(['打野']);
  });

  it('没有就是空 —— 不编位置', () => {
    const positions = lobbyPlayerPositions(
      player({ positions: [], positionLabels: [] })
    );
    expect(positions.codes).toEqual([]);
    expect(positions.labels).toEqual([]);
  });
});

describe('lobbyLastSeenText', () => {
  const now = new Date('2026-11-24T22:16:03');

  it('分钟级', () => {
    expect(lobbyLastSeenText('2026-11-24 22:10:03', now)).toBe('6 分钟前');
  });

  it('小时级', () => {
    expect(lobbyLastSeenText('2026-11-24 20:16:03', now)).toBe('2 小时前');
  });

  it('天级', () => {
    expect(lobbyLastSeenText('2026-11-22 22:16:03', now)).toBe('2 天前');
  });

  it('刚走的显示「刚刚」', () => {
    expect(lobbyLastSeenText('2026-11-24 22:16:00', now)).toBe('刚刚');
  });

  it('没来过 / 认不出来的串不编数字', () => {
    expect(lobbyLastSeenText(null, now)).toBe('不知道');
    expect(lobbyLastSeenText('不是时间', now)).toBe('不是时间');
  });
});

describe('mergeMessages / appendMessages', () => {
  it('同一条消息只留一份', () => {
    const a = [message(1, '一'), message(2, '二')];
    const merged = mergeMessages(a, [message(2, '二'), message(3, '三')]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('新消息追加到后面,顺序是旧的在前', () => {
    const merged = appendMessages([message(1, '一')], message(2, '二'));
    expect(merged.map((m) => m.text)).toEqual(['一', '二']);
  });

  it('超过上限就砍掉最旧的', () => {
    const many = Array.from({ length: LOBBY_HISTORY_LIMIT + 5 }, (_, i) => message(i + 1, `m${i + 1}`));
    const merged = appendMessages(many, message(999, '最后一条'));
    expect(merged).toHaveLength(LOBBY_HISTORY_LIMIT);
    expect(merged[merged.length - 1].text).toBe('最后一条');
  });

  it('正文上限跟后端的列宽对得上', () => {
    // 后端 t_lobby_message.text 是 VARCHAR(64),后端 MAX_TEXT_LEN 也是 64。
    // 这个常量一旦被改成别的数,超长消息会被后端截断 —— 界面上看着像少了一截。
    expect(LOBBY_TEXT_MAX_LEN).toBe(64);
  });
});
