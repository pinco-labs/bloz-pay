// SPDX-License-Identifier: GPL-2.0-or-later
import {existsSync} from 'node:fs';
import {BlozChainProvider,MerchantAddressPool,ReadOnlyChainStore,BLOZ_MAINNET_GENESIS} from './rpc-provider.js';
import {rpcFromEnv} from './rpc-client.js';
const url=new URL(process.env.BLOZ_RPC_URL??'http://127.0.0.1:18211');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('This adapter requires local loopback RPC');
if(!process.env.BLOZ_PAY_CHAIN_DB||!existsSync(process.env.BLOZ_PAY_CHAIN_DB))throw new Error('Complete synchronized local output index required; see backend/CHAIN-MODES.md');
if(!process.env.BLOZ_PAY_ADDRESSES_DB||!existsSync(process.env.BLOZ_PAY_ADDRESSES_DB))throw new Error('Verified merchant address pool required');
const store=new ReadOnlyChainStore(process.env.BLOZ_PAY_CHAIN_DB),addressPool=new MerchantAddressPool(process.env.BLOZ_PAY_ADDRESSES_DB);
export const genesisHash=BLOZ_MAINNET_GENESIS;
export const provider=new BlozChainProvider({store,addressPool,rpc:rpcFromEnv()});
export const closeAdapter=()=>{addressPool.close();store.close()};
