import test from 'node:test';
import assert from 'node:assert/strict';
import {ElectrumProvider} from '../backend/electrum-provider.js';
import {paymentScript,validatePaymentAddress} from '../backend/electrum-address.js';
import {header,hash256,displayHash,parseTransaction,verifyMerkle} from '../backend/electrum-transaction.js';
import {ElectrumAddressPool} from '../backend/electrum-pool.js';
import {BlozPay} from '../backend/sdk.js';
const address='bz1qnsu52p9y9ha7exdscqlsgzzzvmlgpdp82s5k04',script=paymentScript(address),now=1700000000000;
function rawTx({coinbase=false,witness=false,amount=1000000n,target=script,previous='11'.repeat(32)}={}){
 const value=Buffer.alloc(8);value.writeBigUInt64LE(amount);
 const prev=coinbase?'00'.repeat(32)+'ffffffff':previous+'00000000';
 const input=prev+(coinbase?'02abcd':'00')+'ffffffff';
 return '01000000'+(witness?'0001':'')+'01'+input+'01'+value.toString('hex')+'16'+target+(witness?'010101':'')+'00000000';
}
function rawHeader(root='00'.repeat(32),timestamp=now){const h=Buffer.alloc(80);h.writeUInt32LE(1,0);Buffer.from(root,'hex').copy(h,36);h.writeUInt32LE(Math.floor(timestamp/1000),68);return h.toString('hex');}
function fixture(){
 const raw=rawTx(),txid=displayHash(hash256(Buffer.from(raw,'hex'))),genesis=rawHeader(),genesisHash=header(genesis).hash;
 const model={rows:[],raw,txid,payment:rawHeader(Buffer.from(txid,'hex').reverse().toString('hex')),tip:rawHeader(),height:10,offline:false,wrongGenesis:false,disagree:false,changed:false,badMerkle:false,stale:false,reads:new Map()};
 const factory=({host})=>({close(){},call:async(method,params=[])=>{
  if(model.offline)throw new Error('offline');
  if(method==='server.version')return ['ElectrumX','1.4'];
  if(method==='server.features')return {genesis_hash:model.wrongGenesis?'f'.repeat(64):genesisHash,hash_function:'sha256',pruning:null};
  if(method==='blockchain.block.header')return params[0]===0?genesis:model.payment;
  if(method==='blockchain.headers.subscribe')return {height:model.disagree&&host==='second'?9:model.height,hex:model.stale?rawHeader('00'.repeat(32),now-86400001):model.tip};
  if(method==='blockchain.scripthash.get_history'){const calls=(model.reads.get(host)??0)+1;model.reads.set(host,calls);return model.changed&&calls%2===0?[]:model.rows;}
  if(method==='blockchain.transaction.get')return model.raws?.get(params[0])??model.raw;
  if(method==='blockchain.transaction.get_merkle')return model.proofs?.get(params[0])??{block_height:params[1],pos:model.badMerkle?1:0,merkle:[]};
  throw new Error('unexpected method');
 }});
 const provider=new ElectrumProvider({servers:[{host:'first'},{host:'second'}],clientFactory:factory,genesisHash,clock:()=>now,addressPool:{reserve:()=>address}});
 return {model,provider};
}
test('Electrum parses exact raw amounts, SegWit txid, coinbase, and rejects malformed data',()=>{
 assert.equal(validatePaymentAddress(address),true);assert.equal(validatePaymentAddress(address.slice(0,-1)+'x'),false);assert.throws(()=>paymentScript('bz1q'+'0'.repeat(38)));
 const plain=rawTx(),segwit=rawTx({witness:true});assert.equal(parseTransaction(plain).outputs[0].amountRex,'1000000');assert.equal(parseTransaction(segwit).txid,parseTransaction(plain).txid);assert.equal(parseTransaction(rawTx({coinbase:true})).coinbase,true);
 assert.throws(()=>parseTransaction(plain+'00'));assert.throws(()=>parseTransaction(plain.slice(0,-2)));assert.throws(()=>header('00'));
 const txid=parseTransaction(plain).txid,h=header(rawHeader(Buffer.from(txid,'hex').reverse().toString('hex')));
 assert.equal(verifyMerkle(txid,{block_height:9,pos:0,merkle:[]},h,9),true);assert.throws(()=>verifyMerkle(txid,{block_height:9,pos:1,merkle:[]},h,9));
});
test('Electrum fresh two-server view authorizes after two confirmations, retains spent receipts, and revokes on reorg',async()=>{
 const {model,provider}=fixture(),pay=new BlozPay({database:':memory:',provider,genesisHash:provider.genesisHash,clock:()=>now});
 try{
  const invoice=await pay.createInvoice({amount:'0.01',resource:'article',confirmations:2});assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),false);
  model.rows=[{tx_hash:model.txid,height:10}];model.tip=model.payment;
  assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),false);
  model.rows[0].height=9;model.tip=rawHeader();assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),true);
  // Spend the receiving output in a second raw transaction and prove both transactions.
  const spentRaw=rawTx({previous:Buffer.from(model.txid,'hex').reverse().toString('hex'),target:'0014'+'22'.repeat(20),amount:999000n}),spentId=parseTransaction(spentRaw).txid;
  model.raws=new Map([[model.txid,model.raw],[spentId,spentRaw]]);
  model.rows.push({tx_hash:spentId,height:9});
  const merkle=hash256(Buffer.concat([Buffer.from(model.txid,'hex').reverse(),Buffer.from(spentId,'hex').reverse()]));model.payment=rawHeader(merkle.toString('hex'));
  model.proofs=new Map([[model.txid,{block_height:9,pos:0,merkle:[spentId]}],[spentId,{block_height:9,pos:1,merkle:[model.txid]}]]);
  // No UTXO lookup: the original receiving output still authorizes after spending.
  assert.equal((await provider.snapshot(address)).outputs[0].outpoint,model.txid+':0');assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),true);
  model.rows=[];assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),false);
  model.offline=true;assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),false);
 }finally{pay.close()}
});
test('Electrum rejects disagreement, wrong genesis, bad proof/hash, unstable history, stale tip and excessive history',async()=>{
 for(const state of ['disagree','wrongGenesis','badMerkle','changed','stale']){const {model,provider}=fixture();model.rows=[{tx_hash:model.txid,height:9}];model[state]=true;await assert.rejects(provider.snapshot(address),undefined,state);}
 {const {model,provider}=fixture();model.rows=[{tx_hash:'f'.repeat(64),height:9}];await assert.rejects(provider.snapshot(address),/ID mismatch/);}
 {const {model,provider}=fixture();model.rows=[{tx_hash:model.txid,height:9},{tx_hash:model.txid,height:9}];await assert.rejects(provider.snapshot(address),/duplicate/);}
 {const {model,provider}=fixture();provider.maxHistory=1;model.rows=[{tx_hash:model.txid,height:9},{tx_hash:'f'.repeat(64),height:9}];await assert.rejects(provider.snapshot(address),/excessive/);}
});
test('Coinbase cannot pay; address reservation is permanent and imports never reset it',async()=>{
 const pool=new ElectrumAddressPool(':memory:');try{pool.import([address]);assert.equal(pool.reserve(),address);pool.import([address]);assert.throws(()=>pool.reserve(),/exhausted/)}finally{pool.close()}
 const {model,provider}=fixture(),pay=new BlozPay({database:':memory:',provider,genesisHash:provider.genesisHash,clock:()=>now});
 try{const invoice=await pay.createInvoice({amount:'0.01',resource:'article',confirmations:2});model.raw=rawTx({coinbase:true});model.txid=parseTransaction(model.raw).txid;model.payment=rawHeader(Buffer.from(model.txid,'hex').reverse().toString('hex'));model.rows=[{tx_hash:model.txid,height:9}];assert.equal(await pay.authorize(invoice.id,invoice.accessToken,'article'),false)}finally{pay.close()}
});
