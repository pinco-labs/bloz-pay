import test from 'node:test';
import assert from 'node:assert/strict';
import {merchantServer} from '../backend/merchant-api.js';
import {BlozPay} from '../backend/sdk.js';
import {BlozPayMerchantClient} from '../backend/merchant-client.js';

test('merchant API authenticates backend, fixes prices, and revokes resource access after reorg',async()=>{
 const genesis='a'.repeat(64),key='k'.repeat(43);let outputs=[];
 const pay=new BlozPay({database:':memory:',genesisHash:genesis,provider:{allocateAddress:async()=> 'bz1'+'q'.repeat(40),snapshot:async()=>({complete:true,genesisHash:genesis,checkedAt:Date.now(),tipHeight:10,outputs})}});
 const server=merchantServer({pay,apiKey:key,receiptKey:Buffer.alloc(32,7),catalog:{article:{amount:'0.01',resource:'article',confirmations:2,expiresInSeconds:86400},download:{amount:'0.02',resource:'download',confirmations:2,expiresInSeconds:86400}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const client=new BlozPayMerchantClient({url:base,apiKey:key});
 const post=(path,body,credential=key,origin)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential,...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
 try {
  assert.equal((await post('/v1/invoices',{product:'article'},'wrong')).status,401);
  assert.equal((await post('/v1/invoices',{product:'article'},key,'https://shop.example')).status,403);
  assert.equal((await post('/v1/invoices',{product:'article',amount:'0'})).status,400);
  const invoice=await client.createInvoice('article','order-1234567890123456');assert.equal(invoice.amount,'0.01000000');assert.equal(invoice.confirmations,2);
  assert.deepEqual(await client.createInvoice('article','order-1234567890123456'),invoice);
  assert.equal((await post('/v1/invoices',{product:'download',requestId:'order-1234567890123456'})).status,409);
  const authorization={id:invoice.id,product:'article',accessToken:invoice.accessToken};
  assert.equal((await (await post('/v1/authorize',authorization)).json()).authorized,false);
  outputs=[{outpoint:'b'.repeat(64)+':0',amountRex:'1000000',height:10,coinbase:false}];
  assert.equal((await (await post('/v1/status',{id:invoice.id})).json()).status,'confirming');
  outputs[0].height=9;
  assert.equal(await client.authorize(authorization),true);
  assert.equal((await (await post('/v1/authorize',authorization)).json()).authorized,true);
  assert.equal((await (await post('/v1/authorize',{...authorization,product:'download'})).json()).authorized,false);
  assert.equal((await (await post('/v1/authorize',{...authorization,accessToken:'wrong'})).json()).authorized,false);
  outputs=[];
  assert.equal((await (await post('/v1/authorize',authorization)).json()).authorized,false);
  assert.equal((await post('/v1/status',{id:'c'.repeat(48)})).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));pay.close();}
});
