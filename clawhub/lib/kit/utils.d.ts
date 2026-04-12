/**
 * utils.ts — shared helpers.
 */
import type { LogLevel } from './types';
export declare const sol: (lamports: number) => string;
export declare const bpsToPercent: (bps: number) => string;
export declare const decodeBase58: (s: string) => Uint8Array;
export declare function withTimeout<T>(promise: Promise<T>, label: string): Promise<T>;
export declare function createLogger(minLevel: LogLevel): (level: LogLevel, msg: string) => void;
//# sourceMappingURL=utils.d.ts.map