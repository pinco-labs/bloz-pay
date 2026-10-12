// SPDX-License-Identifier: GPL-2.0-or-later
import {toRex} from './money.js';

// Publish only complete snapshots tied to the same chain tip. Never retain stale balances.
export class Mempool {
  constructor(rpc){this.rpc=rpc;this.current=null;this.running=false;}
  async refresh(){
    if(this.running)return;
    this.running=true;
    try{
      const before=await this.rpc.call('getblockchaininfo');
      const ids=await this.rpc.call('getrawmempool');
      if(ids.length>10000)throw new Error('Mempool snapshot too large');
      const raw=new Map();
      for(let i=0;i<ids.length;i+=16){
        const chunk=ids.slice(i,i+16);
        const replies=await this.rpc.batch('getrawtransaction',chunk.map(id=>[id,true]));
        replies.forEach((tx,n)=>raw.set(chunk[n],tx));
      }
      const afterIds=await this.rpc.call('getrawmempool');
      const after=await this.rpc.call('getblockchaininfo');
      if(before.bestblockhash!==after.bestblockhash||ids.length!==afterIds.length||afterIds.some(id=>!raw.has(id)))throw new Error('Mempool changed');
      this.current={hash:after.bestblockhash,checkedAt:Date.now(),raw};
    }catch{this.current=null;}
    finally{this.running=false;}
  }
  view(store){
    const snapshot=this.current;
    if(!snapshot||Date.now()-snapshot.checkedAt>60000||store.tip()?.hash!==snapshot.hash)return {available:false,transactions:[],checkedAt:snapshot?.checkedAt??null};
    const transactions=[];
    for(const tx of snapshot.raw.values()){
      const outputs=tx.vout.map(o=>({txid:tx.txid,n:o.n,address:o.scriptPubKey.address??o.scriptPubKey.addresses?.[0]??null,value_rex:toRex(o.value),spendable:o.scriptPubKey.hex?.startsWith('6a')?'0':'1',spent_by:null}));
      let complete=true;
      const inputs=tx.vin.map((input,n)=>{
        const parent=snapshot.raw.get(input.txid)?.vout.find(o=>o.n===input.vout);
        const previous=parent?{address:parent.scriptPubKey.address??parent.scriptPubKey.addresses?.[0]??null,value_rex:toRex(parent.value)}:store.statement('SELECT address,value_rex FROM outputs WHERE txid=? AND n=?').get(input.txid,input.vout);
        if(!previous)complete=false;
        return {n,previous_txid:input.txid,previous_n:input.vout,address:previous?.address??null,value_rex:previous?.value_rex??null};
      });
      transactions.push({txid:tx.txid,coinbase:'0',confirmations:0,block_height:null,time:null,size:tx.vsize??tx.size,inputs,outputs,fee_rex:complete?inputs.reduce((a,i)=>a+i.value_rex,0n)-outputs.reduce((a,o)=>a+o.value_rex,0n):null});
    }
    const spends=new Map();
    for(const tx of transactions)for(const input of tx.inputs)spends.set(`${input.previous_txid}:${input.previous_n}`,tx.txid);
    for(const tx of transactions)for(const output of tx.outputs)output.spent_by=spends.get(`${tx.txid}:${output.n}`)??null;
    return {available:true,checkedAt:snapshot.checkedAt,transactions};
  }
}
