// SPDX-License-Identifier: GPL-2.0-or-later
import {readFileSync} from 'node:fs';
import {ElectrumProvider} from './electrum-provider.js';
import {ElectrumAddressPool} from './electrum-pool.js';
import {validatePaymentAddress} from './electrum-address.js';
const [input,path,ack]=process.argv.slice(2);
if(!input||!path||ack!=='--merchant-owns-and-backed-up')throw new Error('Usage: node backend/import-electrum-addresses.js PRIVATE_PUBLIC_ADDRESSES.json PRIVATE_POOL.sqlite --merchant-owns-and-backed-up');
const addresses=JSON.parse(readFileSync(input));
if(!Array.isArray(addresses)||!addresses.length||addresses.length>1000||new Set(addresses).size!==addresses.length||addresses.some(a=>!validatePaymentAddress(a)))throw new Error('Expected unique BLOZ public native SegWit v0 addresses');
const provider=new ElectrumProvider();
for(const address of addresses)if((await provider.snapshot(address)).historyCount!==0)throw new Error('An address has prior history; do not reuse it');
const pool=new ElectrumAddressPool(path);try{pool.import(addresses)}finally{pool.close()}
console.log('Verified public addresses imported. No invoice or transfer created; ownership/backup are merchant assertions.');
