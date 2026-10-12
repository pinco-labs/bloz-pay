// SPDX-License-Identifier: GPL-2.0-or-later
import {ElectrumClient} from './electrum-client.js';
import {header,parseTransaction,verifyMerkle,sha256,displayHash} from './electrum-transaction.js';
import {paymentScript} from './electrum-address.js';
export const BLOZ_GENESIS='44c1a8c852b3eda21966e1ddb6b0807e22488dffe8a270bf24bf1fa2d66c13bd';
export const DEFAULT_ELECTRUM_SERVERS=[{host:'electrum-bloz.pinco-labs.com',port:50002},{host:'electrum2-bloz.pinco-labs.com',port:50002}];
function history(value,max,tip){
 if(!Array.isArray(value)||value.length>max)throw new Error('Incomplete or excessive Electrum history');
 const seen=new Set();return value.map(item=>{if(!item||typeof item.tx_hash!=='string'||!/^[a-f0-9]{64}$/.test(item.tx_hash)||seen.has(item.tx_hash)||!Number.isSafeInteger(item.height)||item.height< -1||item.height>tip)throw new Error('Invalid or duplicate history');seen.add(item.tx_hash);return {tx_hash:item.tx_hash,height:item.height};}).sort((a,b)=>a.tx_hash.localeCompare(b.tx_hash));
}
export class ElectrumProvider {
 constructor({servers=DEFAULT_ELECTRUM_SERVERS,clientFactory=options=>new ElectrumClient(options),addressPool=null,genesisHash=BLOZ_GENESIS,maxHistory=1000,maxTipAgeMs=86400000,deadlineMs=20000,clock=Date.now}={}){
  if(!Array.isArray(servers)||servers.length!==2||servers[0].host===servers[1].host)throw new Error('Two distinct Electrum hosts required');
  if(!Number.isInteger(maxHistory)||maxHistory<1||maxHistory>1000||!Number.isFinite(maxTipAgeMs)||maxTipAgeMs<=0||!Number.isFinite(deadlineMs)||deadlineMs<=0)throw new Error('Invalid Electrum limits');
  this.servers=servers;this.clientFactory=clientFactory;this.addressPool=addressPool;this.genesisHash=genesisHash;this.maxHistory=maxHistory;this.maxTipAgeMs=maxTipAgeMs;this.deadlineMs=deadlineMs;this.clock=clock;this.queue=Promise.resolve();
 }
 snapshot(address){const task=this.queue.then(()=>this.collect(address));this.queue=task.catch(()=>{});return task;}
 async collect(address){
  const script=paymentScript(address),scripthash=displayHash(sha256(Buffer.from(script,'hex'))),clients=this.servers.map(options=>this.clientFactory(options));
  const timer=setTimeout(()=>clients.forEach(client=>client.close()),this.deadlineMs);
  try{
   const views=await Promise.all(clients.map(async client=>{
    await client.call('server.version',['BLOZ Pay','1.4']);const features=await client.call('server.features');
    if(features?.genesis_hash!==this.genesisHash||features.hash_function!=='sha256'||features.pruning!==null)throw new Error('Wrong or pruned Electrum chain');
    const genesis=header(await client.call('blockchain.block.header',[0]));if(genesis.hash!==this.genesisHash)throw new Error('Genesis header mismatch');
    const tip=await client.call('blockchain.headers.subscribe');if(!Number.isSafeInteger(tip?.height)||tip.height<1)throw new Error('Invalid Electrum tip');
    const tipHeader=header(tip.hex),now=this.clock();if(tipHeader.timestamp>now+7200000||now-tipHeader.timestamp>this.maxTipAgeMs)throw new Error('Stale or future Electrum tip');
    const rows=history(await client.call('blockchain.scripthash.get_history',[scripthash]),this.maxHistory,tip.height),outputs=[],headers=new Map();
    for(const row of rows){
     const tx=parseTransaction(await client.call('blockchain.transaction.get',[row.tx_hash,false]));if(tx.txid!==row.tx_hash)throw new Error('Raw transaction ID mismatch');
     let rawHeader=null;
     if(row.height>0){rawHeader=await client.call('blockchain.block.header',[row.height]);const h=header(rawHeader);verifyMerkle(row.tx_hash,await client.call('blockchain.transaction.get_merkle',[row.tx_hash,row.height]),h,row.height);if(row.height===tip.height&&h.hash!==tipHeader.hash)throw new Error('Payment block disagrees with tip');headers.set(row.height,rawHeader);}
     for(const output of tx.outputs)if(output.script===script)outputs.push({outpoint:tx.txid+':'+output.n,amountRex:output.amountRex,height:row.height>0?row.height:null,coinbase:tx.coinbase});
    }
    const after=await client.call('blockchain.headers.subscribe'),again=history(await client.call('blockchain.scripthash.get_history',[scripthash]),this.maxHistory,tip.height);
    if(after.height!==tip.height||after.hex!==tip.hex||JSON.stringify(rows)!==JSON.stringify(again))throw new Error('Electrum chain/history changed during verification');
    for(const [height,raw] of headers)if(await client.call('blockchain.block.header',[height])!==raw)throw new Error('Payment block changed during verification');
    return {tipHeight:tip.height,tipHash:tipHeader.hash,rows,headers:[...headers].sort((a,b)=>a[0]-b[0]),outputs:outputs.sort((a,b)=>a.outpoint.localeCompare(b.outpoint))};
   }));
   if(JSON.stringify(views[0])!==JSON.stringify(views[1]))throw new Error('Electrum servers disagree');
   return {complete:true,genesisHash:this.genesisHash,checkedAt:this.clock(),tipHeight:views[0].tipHeight,historyCount:views[0].rows.length,outputs:views[0].outputs};
  }finally{clearTimeout(timer);clients.forEach(client=>client.close());}
 }
 async allocateAddress(){if(!this.addressPool)throw new Error('Verified merchant-owned address pool required');for(let i=0;i<100;i++){const address=this.addressPool.reserve();if((await this.snapshot(address)).historyCount===0)return address;}throw new Error('Imported addresses already used');}
}
