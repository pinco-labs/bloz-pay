// SPDX-License-Identifier: GPL-2.0-or-later
import {DatabaseSync} from 'node:sqlite';
import {Mempool} from './rpc-mempool.js';

export const BLOZ_MAINNET_GENESIS='44c1a8c852b3eda21966e1ddb6b0807e22488dffe8a270bf24bf1fa2d66c13bd';
const alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
// Restrict the first merchant adapter to lowercase native SegWit v0 keyhash addresses.
export function validatePaymentAddress(address){
 if(typeof address!=='string'||address.length>90||!address.startsWith('bz1')||address!==address.toLowerCase())return false;
 const separator=address.lastIndexOf('1'),hrp=address.slice(0,separator),data=[...address.slice(separator+1)].map(c=>alphabet.indexOf(c));
 if(hrp!=='bz'||data.length<7||data.some(n=>n<0))return false;
 let checksum=1;const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
 for(const value of [...[...hrp].map(c=>c.charCodeAt(0)>>5),0,...[...hrp].map(c=>c.charCodeAt(0)&31),...data]){const top=checksum>>>25;checksum=((checksum&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)checksum^=generators[i];}
 if(checksum!==1||data[0]!==0)return false;
 let accumulator=0,bits=0;const program=[];
 for(const value of data.slice(1,-6)){accumulator=((accumulator<<5)|value)&0xffff;bits+=5;while(bits>=8){bits-=8;program.push((accumulator>>>bits)&255);}}
 return bits<5&&((accumulator<<(8-bits))&255)===0&&program.length===20;
}

export class MerchantAddressPool {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS addresses(address TEXT PRIMARY KEY,reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved IN(0,1))) STRICT;');}
 import(addresses){
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>10000||addresses.some(a=>!validatePaymentAddress(a))||new Set(addresses).size!==addresses.length)throw new Error('Expected unique valid BLOZ native SegWit v0 addresses');
  this.db.exec('BEGIN IMMEDIATE');try{for(const address of addresses)this.db.prepare('INSERT OR IGNORE INTO addresses(address) VALUES(?)').run(address);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 reserve(){
  this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT address FROM addresses WHERE reserved=0 ORDER BY rowid LIMIT 1').get();if(!row)throw new Error('Merchant address pool exhausted');this.db.prepare('UPDATE addresses SET reserved=1 WHERE address=?').run(row.address);this.db.exec('COMMIT');return row.address;}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 close(){this.db.close();}
}

export class ReadOnlyChainStore {
 constructor(path){this.db=new DatabaseSync(path,{readOnly:true});this.db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000;');}
 statement(sql){const statement=this.db.prepare(sql);statement.setReadBigInts(true);return statement;}
 tip(){return this.statement('SELECT height,hash FROM blocks ORDER BY height DESC LIMIT 1').get();}
 snapshot(work){this.db.exec('BEGIN');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 close(){this.db.close();}
}

export class BlozChainProvider {
 constructor({store,rpc,addressPool=null,genesisHash=BLOZ_MAINNET_GENESIS}){this.store=store;this.rpc=rpc;this.addressPool=addressPool;this.genesisHash=genesisHash;this.mempool=new Mempool(rpc);this.queue=Promise.resolve();}
 snapshot(address){
  const work=this.queue.then(()=>this.collect(address));this.queue=work.catch(()=>{});return work;
 }
 async collect(address){
  if(!validatePaymentAddress(address))throw new Error('Invalid BLOZ payment address');
  const genesis=await this.rpc.call('getblockhash',[0]);if(genesis!==this.genesisHash)throw new Error('Wrong blockchain');
  const before=await this.rpc.call('getblockchaininfo');
  if(before.initialblockdownload!==false||before.pruned!==false||!Number.isSafeInteger(before.blocks))throw new Error('Node not ready');
  await this.mempool.refresh();
  const view=this.store.snapshot(()=>{
   const tip=this.store.tip(),indexedGenesis=this.store.statement('SELECT hash FROM blocks WHERE height=0').get()?.hash;
   if(!tip||indexedGenesis!==genesis||tip.hash!==before.bestblockhash||tip.height!==BigInt(before.blocks))throw new Error('Indexer not aligned with node');
   const pending=this.mempool.view(this.store);if(!pending.available)throw new Error('Incomplete mempool');
   const confirmed=this.store.statement('SELECT o.txid,o.n,o.value_rex,t.block_height,t.coinbase FROM outputs o JOIN transactions t ON t.txid=o.txid WHERE o.address=? ORDER BY t.block_height,o.txid,o.n').all(address);
   const outputs=confirmed.map(o=>({outpoint:`${o.txid}:${o.n}`,amountRex:o.value_rex.toString(),height:Number(o.block_height),coinbase:o.coinbase===1n}));
   for(const tx of pending.transactions)for(const output of tx.outputs)if(output.address===address)outputs.push({outpoint:`${tx.txid}:${output.n}`,amountRex:output.value_rex.toString(),height:null,coinbase:false});
   return {outputs,tipHeight:Number(tip.height),hash:tip.hash};
  });
  const ids=await this.rpc.call('getrawmempool'),after=await this.rpc.call('getblockchaininfo');
  const indexTip=this.store.tip();
  if(after.bestblockhash!==view.hash||after.blocks!==view.tipHeight||after.initialblockdownload!==false||indexTip?.hash!==view.hash||ids.length!==this.mempool.current.raw.size||ids.some(id=>!this.mempool.current.raw.has(id)))throw new Error('Chain or mempool changed during verification');
  return {complete:true,genesisHash:genesis,checkedAt:Date.now(),tipHeight:view.tipHeight,outputs:view.outputs};
 }
 async allocateAddress(){
  if(!this.addressPool)throw new Error('Merchant address pool required');
  for(let i=0;i<100;i++){const address=this.addressPool.reserve();const snapshot=await this.snapshot(address);if(snapshot.outputs.length===0)return address;}
  throw new Error('Imported addresses already used');
 }
}
