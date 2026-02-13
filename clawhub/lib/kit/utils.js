"use strict";
/**
 * utils.ts — shared helpers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bpsToPercent = exports.sol = void 0;
exports.createLogger = createLogger;
const torchsdk_1 = require("torchsdk");
const sol = (lamports) => (lamports / torchsdk_1.LAMPORTS_PER_SOL).toFixed(4);
exports.sol = sol;
const bpsToPercent = (bps) => (bps / 100).toFixed(2) + '%';
exports.bpsToPercent = bpsToPercent;
const LEVEL_ORDER = ['debug', 'info', 'warn', 'error'];
function createLogger(minLevel) {
    const minIdx = LEVEL_ORDER.indexOf(minLevel);
    return function log(level, msg) {
        if (LEVEL_ORDER.indexOf(level) < minIdx)
            return;
        const ts = new Date().toISOString().substr(11, 12);
        const tag = level.toUpperCase().padEnd(5);
        console.log(`[${ts}] ${tag} ${msg}`);
    };
}
//# sourceMappingURL=utils.js.map