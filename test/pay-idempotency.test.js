import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BlozPay} from '../backend/sdk.js';

test('order receipt survives restart encrypted; conflicts and interrupted creation never duplicate payment',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bloz-order-'));let allocations=0,pay;
 const provider={allocateAddress:async()=>{allocations++;return 'bz1'+'q'.repeat(40);},snapshot:async()=>null};
 const open=()=>new BlozPay({database:join(dir,'pay.sqlite'),provider,genesisHash:'a'.repeat(64)});
 const key=Buffer.alloc(32,17),request={requestId:'order-1234567890123456',product:'article',options:{amount:'0.01',resource:'article',confirmations:2},key};
 try{
  pay=open();const original=await pay.createIdempotentInvoice(request);
  const stored=Buffer.from(pay.db.prepare('SELECT receipt FROM payment_requests').get().receipt);
  assert.equal(stored.includes(Buffer.from(original.accessToken)),false);
  pay.close();pay=open();
  assert.deepEqual(await pay.createIdempotentInvoice({...request,options:{...request.options,amount:'0.99'}}),original);
  assert.equal(allocations,1);
  await assert.rejects(pay.createIdempotentInvoice({...request,product:'other'}),{code:'CONFLICT'});
  await assert.rejects(pay.createIdempotentInvoice({...request,key:Buffer.alloc(32,18)}));
  pay.db.prepare('INSERT INTO payment_requests(request,product) VALUES(?,?)').run('interrupted-123456789','article');
  await assert.rejects(pay.createIdempotentInvoice({...request,requestId:'interrupted-123456789'}),{code:'CONFLICT'});
  assert.equal(allocations,1);assert.equal(pay.db.prepare('SELECT count(*) n FROM invoices').get().n,1);
 }finally{pay?.close();for(const name of readdirSync(dir))unlinkSync(join(dir,name));rmdirSync(dir);}
});
