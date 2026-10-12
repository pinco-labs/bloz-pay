import test from 'node:test';import assert from 'node:assert/strict';import {BlozPay} from '../backend/sdk.js';
test('confirmation count covers the required amount across split payments; dust does not lower it',async()=>{
 let outputs=[];const pay=new BlozPay({database:':memory:',genesisHash:'a'.repeat(64),provider:{allocateAddress:async()=> 'bz1'+'q'.repeat(40),snapshot:async()=>({complete:true,genesisHash:'a'.repeat(64),checkedAt:Date.now(),tipHeight:10,outputs})}});
 try{const invoice=await pay.createInvoice({amount:'1',resource:'article',confirmations:2});
 outputs=[{outpoint:'b'.repeat(64)+':0',amountRex:'60000000',height:6,coinbase:false}];assert.equal((await pay.check(invoice.id)).paymentConfirmations,null);
 outputs.push({outpoint:'c'.repeat(64)+':0',amountRex:'40000000',height:10,coinbase:false});let result=await pay.check(invoice.id);assert.equal(result.paymentConfirmations,1);assert.equal(result.access,false);
 outputs[1].height=9;outputs.push({outpoint:'d'.repeat(64)+':0',amountRex:'1',height:null,coinbase:false});result=await pay.check(invoice.id);assert.equal(result.paymentConfirmations,2);assert.equal(result.access,true);
 outputs=[];assert.equal((await pay.check(invoice.id)).access,false);
 }finally{pay.close()}
});
