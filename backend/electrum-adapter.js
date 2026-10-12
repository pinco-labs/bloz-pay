// SPDX-License-Identifier: GPL-2.0-or-later
import {existsSync} from 'node:fs';
import {ElectrumProvider,BLOZ_GENESIS} from './electrum-provider.js';
import {ElectrumAddressPool} from './electrum-pool.js';
if(process.env.BLOZ_PAY_ELECTRUM_TRUST!=='two-server-trusted-history')throw new Error('Explicit Electrum trust policy required; read backend/ELECTRUM.md first');
if(!process.env.BLOZ_PAY_ADDRESSES_DB||!existsSync(process.env.BLOZ_PAY_ADDRESSES_DB))throw new Error('Import verified wallet public addresses into a dedicated pool first');
const addressPool=new ElectrumAddressPool(process.env.BLOZ_PAY_ADDRESSES_DB);
export const genesisHash=BLOZ_GENESIS;
export const provider=new ElectrumProvider({addressPool});
export const closeAdapter=()=>addressPool.close();
