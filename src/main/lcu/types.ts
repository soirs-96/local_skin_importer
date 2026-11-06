/**
 * LCU 检测用的全部类型与文案词汇表。
 *
 * 这个文件**不 import 任何东西** —— 它是依赖图的底,其它模块都往上依赖它。
 * 加 import 就会绕成环。
 */

/** 客户端归属。国服 WeGame 是我们要支持的那一个。 */
export type LcuAuthOrigin = 'cn' | 'riot';

/** LCU 的传输协议。老客户端用 http,新客户端用 https(自签证书)。 */
export type LcuProtocol = 'http' | 'https';

/** 一份能连上 LCU 的凭据。 */
export interface LcuAuth {
  port: number;
  token: string;
  protocol: LcuProtocol;
  host: string;
}

/** 候选是从哪条通道来的。 */
export type LcuCandidateSource = 'process' | 'lockfile' | 'disk-scan' | 'cache' | 'memory';

/** 一条候选凭据:凭据本身 + 归属 + 来源。 */
export interface LcuCandidate extends LcuAuth {
  origin: LcuAuthOrigin;
  source: LcuCandidateSource;
}

/** 一次实测的结论。 */
export type LcuProbeOutcome = 'alive' | 'dead' | 'unauthorized' | 'not-lcu' | 'not-ready';

/**
 * 检测失败的原因分类。界面上的一句话结论由它决定。
 *
 * `client-not-running` 和 `client-query-failed` 必须分开:
 * 前者是「查了,确实没有」,后者是「连查都没查成」(PowerShell 被拦/超时)。
 * 混在一起的话,用户明明开着客户端也会被告知「没检测到客户端」。
 */
export type LcuFailureCode =
  | 'client-not-running'
  | 'client-query-failed'
  | 'client-starting'
  | 'stale-credentials'
  | 'not-cn-client'
  | 'not-a-lcu'
  | 'scan-timeout'
  | 'unknown';

/** 全部失败分类码,顺序即优先级。 */
export const FAILURE_CODES: readonly LcuFailureCode[] = [
  'client-not-running',
  'client-query-failed',
  'client-starting',
  'stale-credentials',
  'not-cn-client',
  'not-a-lcu',
  'scan-timeout',
  'unknown'
];

/**
 * 每个失败分类对应的一句话结论。
 *
 * 写给**用户**看 —— 目标是让人照着这句话就知道下一步该干什么,
 * 而不是让人看完再去猜。也写给开发者看 —— 截图发出来就能定位问题。
 */
export const FAILURE_SUMMARIES: Record<LcuFailureCode, string> = {
  'client-not-running':
    '没检测到英雄联盟客户端 —— 确认客户端已进到大厅再点检测;若客户端确实开着,请点顶部「开发日志」把日志发给我们。',
  'client-query-failed':
    '没能查询客户端进程 —— 可能被安全软件拦截,或客户端以管理员身份运行(试试右键本程序「以管理员身份运行」)。',
  'client-starting': '找到了客户端但它还没准备好 —— 等 5 秒再点检测。',
  'stale-credentials': '客户端重启过、凭据失效 —— 点检测重试。',
  'not-cn-client': '装的是国际服客户端 —— 本工具只支持国服,请装国服客户端。',
  'not-a-lcu': '连上的不是游戏客户端接口 —— 可能是端口被别的程序占用。',
  'scan-timeout': '没在常见位置找到客户端 —— 可能装在非标准位置。',
  unknown: '检测失败 —— 打开开发者面板看详情。'
};

/** 当前召唤师。 */
export interface CurrentSummoner {
  displayName: string;
  puuid: string;
}

/** 一条候选的实测记录,诊断面板里逐条展示。 */
export interface LcuProbeRecord {
  port: number;
  origin: LcuAuthOrigin;
  probe: LcuProbeOutcome;
  /** 通道内部的补充说明(lockfile 路径、PowerShell 报错等)。 */
  detail?: string;
}

/** 单条发现通道的执行报告。 */
export interface LcuChannelReport {
  source: LcuCandidateSource;
  /** 这条通道是否成功产出了可用凭据。 */
  ok: boolean;
  /** 是否查到活的 LeagueClientUx.exe 进程。 */
  liveProcess: boolean;
  /** 这条通道的整体说明(失败原因 / 命中路径)。 */
  detail: string;
  candidates: LcuProbeRecord[];
  /** 磁盘扫描 / lockfile 通道用得上:试过哪些路径。 */
  paths?: string[];
}

/** 检测时的环境快照,诊断面板里展示,便于判断是不是代理/环境问题。 */
export interface LcuEnvironment {
  /** 生效中的代理环境变量名(不含值 —— 值是凭据类的敏感信息,不往外带)。 */
  proxyVars: string[];
  localAppData: string | null;
  electron: string;
  node: string;
}

/** 完整的失败诊断。 */
export interface LcuDiagnosis {
  code: LcuFailureCode;
  summary: string;
  channels: LcuChannelReport[];
  environment: LcuEnvironment;
  /** 内部异常时的原始错误信息。正常失败路径下不出现。 */
  error?: string;
}

/** 检测结果。成功给凭据,失败给分类 + 一句话结论 + 明细。 */
export type LcuDetectionResult =
  | { ok: true; auth: LcuAuth; summoner: CurrentSummoner }
  | { ok: false; code: LcuFailureCode; summary: string; diagnosis: LcuDiagnosis };
