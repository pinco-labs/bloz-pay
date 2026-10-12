// SPDX-License-Identifier: GPL-2.0-or-later
import {ElectrumProvider} from './electrum-provider.js';
const address=process.argv[2];if(!address)throw new Error('Usage: node backend/probe-electrum.js PUBLIC_BLOZ_ADDRESS');
const snapshot=await new ElectrumProvider().snapshot(address);
console.log(JSON.stringify({mode:'read-only; no invoice or funds moved',tipHeight:snapshot.tipHeight,historyCount:snapshot.historyCount,outputs:snapshot.outputs.length,coinbaseOutputs:snapshot.outputs.filter(o=>o.coinbase).length,confirmedOutputs:snapshot.outputs.filter(o=>o.height!==null).length}));
