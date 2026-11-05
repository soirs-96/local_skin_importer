/**
 * LCU 相关能力的统一出口。
 *
 * 保留成 barrel 是因为 `ipc.ts` / `match/poller.ts` / `match/iconAssets.ts` /
 * `owned.ts` 都是 `import * as lcu from './lcu'` —— 改 import 路径会波及四个文件。
 *
 * 注意:barrel 里 `export *` 的名字**不能重名**。加新导出前先确认没被上面任何一个
 * 模块占用。
 */
export * from './lcu/types';
export * from './lcu/parse';
export * from './lcu/client';
export * from './lcu/scan';
export * from './lcu/channels';
export * from './lcu/credentials';
