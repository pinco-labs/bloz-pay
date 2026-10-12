import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {BlozPay} from '../backend/sdk.js';import {merchantServer} from '../backend/merchant-api.js';
const provider={allocateAddress:async()=> 'bz1'+'q'.repeat(40),snapshot:async()=>{throw new Error('private backend error')}};
test('payment database remains bound to its chain across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bloz-chain-binding-')),database=join(dir,'pay.sqlite');
 try{new BlozPay({database,provider,genesisHash:'a'.repeat(64)}).close();assert.throws(()=>new BlozPay({database,provider,genesisHash:'b'.repeat(64)}),/another blockchain/);new BlozPay({database,provider,genesisHash:'a'.repeat(64)}).close();}finally{rmSync(dir,{recursive:true,force:true})}
});
test('merchant rejects browser/host/input attacks and conceals internal provider errors',async()=>{
 const pay=new BlozPay({database:':memory:',provider,genesisHash:'a'.repeat(64)}),key='k'.repeat(43);
 const server=merchantServer({pay,apiKey:key,receiptKey:Buffer.alloc(32,9),catalog:{article:{amount:'1',resource:'article',confirmations:2,expiresInSeconds:86400}},port:0});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,...extra},body:typeof body==='string'?body:JSON.stringify(body)});
 try{
  assert.equal((await post('/v1/invoices',{}, {Origin:'https://untrusted.example'})).status,403);
  assert.equal((await post('/v1/invoices',{}, {Host:'untrusted.example'})).status,400);
  assert.equal((await post('/v1/invoices','{')).status,400);assert.equal((await post('/v1/invoices','x'.repeat(2049))).status,413);
  const invoice=await (await post('/v1/invoices',{product:'article',requestId:'security-order-123456789'})).json();
  assert.equal((await post('/v1/status',{id:invoice.id,amount:'0'})).status,400);
  assert.equal((await post('/v1/authorize',{id:invoice.id,product:'article',accessToken:invoice.accessToken,authorized:true})).status,400);
  const denied=await (await post('/v1/authorize',{id:invoice.id,product:'article',accessToken:'wrong'})).json();assert.equal(denied.authorized,false);
  const unavailable=await (await post('/v1/authorize',{id:invoice.id,product:'article',accessToken:invoice.accessToken})).json();assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.authorized,false);assert.equal(JSON.stringify(unavailable).includes('private backend error'),false);
 }finally{await new Promise(r=>server.close(r));pay.close()}
});
