import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {BlozChainProvider} from '../backend/rpc-provider.js';
import {Rpc} from '../backend/rpc-client.js';
import {BlozPay} from '../backend/sdk.js';
const address='bz1qnsu52p9y9ha7exdscqlsgzzzvmlgpdp82s5k04',hash=n=>n.toString(16).padStart(64,'0');
test('local RPC/index retains spent outputs, enforces two confirmations, and denies lag/reorg/pruned node',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE blocks(height INTEGER PRIMARY KEY,hash TEXT); CREATE TABLE transactions(txid TEXT PRIMARY KEY,block_height INTEGER,coinbase INTEGER); CREATE TABLE outputs(txid TEXT,n INTEGER,value_rex INTEGER,address TEXT);');
 db.prepare('INSERT INTO blocks VALUES(?,?)').run(0,hash(1));db.prepare('INSERT INTO blocks VALUES(?,?)').run(1,hash(2));db.prepare('INSERT INTO blocks VALUES(?,?)').run(2,hash(3));
 const statement=sql=>{const s=db.prepare(sql);s.setReadBigInts(true);return s;};
 const store={statement,tip:()=>statement('SELECT height,hash FROM blocks ORDER BY height DESC LIMIT 1').get(),snapshot:work=>{db.exec('BEGIN');try{const r=work();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
 let height=2,tipHash=hash(3),pruned=false;
 const rpc={call:async method=>{if(method==='getblockhash')return hash(1);if(method==='getblockchaininfo')return {blocks:height,bestblockhash:tipHash,initialblockdownload:false,pruned};if(method==='getrawmempool')return [];throw new Error('Unexpected method')},batch:async()=>[]};
 const provider=new BlozChainProvider({store,rpc,genesisHash:hash(1),addressPool:{reserve:()=>address}}),pay=new BlozPay({database:':memory:',provider,genesisHash:hash(1)});
 try{
  const invoice=await pay.createInvoice({amount:'1',resource:'article',confirmations:2});
  db.prepare('INSERT INTO transactions VALUES(?,?,?)').run(hash(99),1,0);db.prepare('INSERT INTO outputs VALUES(?,?,?,?)').run(hash(99),0,100000000,address);
  assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),true);
  // Receipt lookup deliberately uses all historical outputs, not current UTXOs.
  assert.equal((await provider.snapshot(address)).outputs[0].amountRex,'100000000');
  tipHash=hash(4);assert.equal((await pay.check(invoice.id)).status,'unavailable');tipHash=hash(3);
  pruned=true;assert.equal((await pay.check(invoice.id)).status,'unavailable');pruned=false;
  db.exec('DELETE FROM blocks WHERE height=2; DELETE FROM transactions; DELETE FROM outputs');height=1;tipHash=hash(2);
  assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),false);
 }finally{pay.close();db.close()}
});
test('RPC client rejects insecure remote credentials and transaction broadcasts',async()=>{
 assert.throws(()=>new Rpc({url:'http://example.com',user:'test',password:'test'}));
 const rpc=new Rpc({url:'http://127.0.0.1:18211',user:'fixture',password:'fixture'});
 await assert.rejects(rpc.call('sendrawtransaction',['00']),/not allowed/);
});
