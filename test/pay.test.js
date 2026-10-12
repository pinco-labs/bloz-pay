import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BlozPay} from '../backend/sdk.js';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const genesis='a'.repeat(64),tx='b'.repeat(64)+':0';
test('BLOZ Pay exact amounts, confirmation, authorization and reorg',async()=>{
 let now=100000,outputs=[],tip=100;
 const provider={allocateAddress:async()=> 'bz1q'+'a'.repeat(38),snapshot:async()=>({complete:true,genesisHash:genesis,checkedAt:now,tipHeight:tip,outputs})};
 const pay=new BlozPay({database:':memory:',provider,genesisHash:genesis,clock:()=>now});
 try{
  const invoice=await pay.createInvoice({amount:'0.00000003',resource:'article',confirmations:2,expiresInSeconds:60});
  assert.equal((await pay.check(invoice.id)).status,'awaiting');
  outputs=[{outpoint:tx,amountRex:'2',height:null,coinbase:false}];assert.equal((await pay.check(invoice.id)).status,'partial');
  outputs.push({outpoint:'c'.repeat(64)+':0',amountRex:'1',height:100,coinbase:false});assert.equal((await pay.check(invoice.id)).status,'confirming');
  outputs[0].height=100;tip=101;assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),true);
  assert.equal(await pay.authorize(invoice.id,'wrong','article'),false);assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'other'),false);
  outputs=[];assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),false);
  now+=61000;outputs=[{outpoint:'d'.repeat(64)+':0',amountRex:'3',height:100,coinbase:false}];const late=await pay.check(invoice.id);assert.equal(late.status,'expired');assert.equal(late.lateRex,'3');
  await assert.rejects(()=>pay.createInvoice({amount:'1',resource:'another'}),/UNIQUE/);
 }finally{pay.close();}
});
test('BLOZ Pay persists pre-expiry observations and token hash across restart',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'bloz-pay-'));let now=100000,tip=100;
 const provider={allocateAddress:async()=> 'bz1q'+'a'.repeat(38),snapshot:async()=>({complete:true,genesisHash:genesis,checkedAt:now,tipHeight:tip,outputs:[{outpoint:tx,amountRex:'100000000',height:100,coinbase:false}]})};
 const config={database:join(directory,'pay.sqlite'),provider,genesisHash:genesis,clock:()=>now};let pay=new BlozPay(config);
 try{const invoice=await pay.createInvoice({amount:'1',resource:'file',expiresInSeconds:60,confirmations:2});assert.equal((await pay.check(invoice.id)).status,'confirming');pay.close();now+=61000;tip=101;pay=new BlozPay(config);assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'file'),true);}finally{pay.close();for(const name of readdirSync(directory))unlinkSync(join(directory,name));rmdirSync(directory);}
});
test('BLOZ Pay rejects unavailable, stale, wrong-chain, duplicate outputs and coinbase payments',async()=>{
 let snap={complete:true,genesisHash:genesis,checkedAt:100000,tipHeight:100,outputs:[]};
 const pay=new BlozPay({database:':memory:',genesisHash:genesis,clock:()=>100000,provider:{allocateAddress:async()=> 'bz1q'+'a'.repeat(38),snapshot:async()=>snap}});
 try{const inv=await pay.createInvoice({amount:'1',resource:'file'});
  for(const patch of [{complete:false},{checkedAt:0},{genesisHash:'f'.repeat(64)},{outputs:[{outpoint:tx,amountRex:'1',height:100,coinbase:false},{outpoint:tx,amountRex:'1',height:100,coinbase:false}]}]){const original=snap;snap={...snap,...patch};assert.equal((await pay.check(inv.id)).status,'unavailable');snap=original;}
  snap.outputs=[{outpoint:tx,amountRex:'100000000',height:1,coinbase:true}];assert.equal((await pay.check(inv.id)).access,false);
  await assert.rejects(()=>pay.createInvoice({amount:1,resource:'file'}),/decimal string/);
 }finally{pay.close();}
});
