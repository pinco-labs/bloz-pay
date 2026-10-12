import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {toRex,formatBloz} from './money.js';

const digest=value=>createHash('sha256').update(value).digest();
const MAX_REX=9223372036854775807n;
export class BlozPay {
 constructor({database,provider,genesisHash,clock=Date.now,maxAgeMs=60000}){
  if(!/^[a-f0-9]{64}$/.test(genesisHash)||!provider?.allocateAddress||!provider?.snapshot)throw new Error('Payment provider and pinned chain required');
  this.provider=provider;this.genesisHash=genesisHash;this.clock=clock;this.maxAgeMs=maxAgeMs;this.checks=new Map();
  this.db=new DatabaseSync(database);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,address TEXT UNIQUE NOT NULL,amount INTEGER NOT NULL,resource TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,minconf INTEGER NOT NULL,tokenhash BLOB NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS observations(invoice TEXT NOT NULL REFERENCES invoices(id),outpoint TEXT NOT NULL,firstseen INTEGER NOT NULL,PRIMARY KEY(invoice,outpoint)) STRICT;
   CREATE TABLE IF NOT EXISTS payment_requests(request TEXT PRIMARY KEY,product TEXT NOT NULL,invoice TEXT REFERENCES invoices(id),receipt BLOB) STRICT;
   CREATE TABLE IF NOT EXISTS payment_metadata(name TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;`);
  try{
   this.db.prepare('INSERT OR IGNORE INTO payment_metadata VALUES(?,?)').run('genesis',genesisHash);
   if(this.db.prepare('SELECT value FROM payment_metadata WHERE name=?').get('genesis').value!==genesisHash)throw new Error('Payment database belongs to another blockchain; use its original configuration');
  }catch(error){this.db.close();throw error;}
 }
 async createInvoice({amount,resource,expiresInSeconds=900,confirmations=6},request=null){
  if(typeof amount!=='string')throw new Error('Amount must be a decimal string');
  const rex=toRex(amount);
  if(rex<=0n||rex>MAX_REX||typeof resource!=='string'||!resource||resource.length>100||!Number.isSafeInteger(expiresInSeconds)||expiresInSeconds<60||expiresInSeconds>86400||!Number.isSafeInteger(confirmations)||confirmations<1||confirmations>1000)throw new Error('Invalid invoice');
  // The provider must allocate a never-used merchant-owned address; no wallet keys enter this SDK.
  const address=await this.provider.allocateAddress();
  if(typeof address!=='string'||!/^bz1[a-z0-9]{11,97}$/.test(address))throw new Error('Provider returned invalid address');
  const now=this.clock(),id=randomBytes(24).toString('hex'),token=randomBytes(32).toString('base64url');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?)').run(id,address,rex,resource,now,now+expiresInSeconds*1000,confirmations,digest(token));
   const result={...this.invoice(id),accessToken:token};
   if(request){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',request.key,iv);
    cipher.setAAD(Buffer.from(request.id+'\0'+request.product));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(result),'utf8'),cipher.final()]);
    this.db.prepare('UPDATE payment_requests SET invoice=?,receipt=? WHERE request=?').run(id,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),request.id);
   }
   this.db.exec('COMMIT');return result;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 async createIdempotentInvoice({requestId,product,options,key}){
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId??'')||typeof product!=='string'||!Buffer.isBuffer(key)||key.length!==32)throw new Error('Invalid idempotent request');
  const existing=this.db.prepare('SELECT * FROM payment_requests WHERE request=?').get(requestId);
  if(existing){
   if(existing.product!==product||!existing.receipt){const error=new Error('Request conflicts or is pending; reconcile before retrying');error.code='CONFLICT';throw error;}
   const blob=Buffer.from(existing.receipt),decipher=createDecipheriv('aes-256-gcm',key,blob.subarray(0,12));
   decipher.setAAD(Buffer.from(requestId+'\0'+product));decipher.setAuthTag(blob.subarray(12,28));
   return JSON.parse(Buffer.concat([decipher.update(blob.subarray(28)),decipher.final()]).toString('utf8'));
  }
  try{this.db.prepare('INSERT INTO payment_requests(request,product) VALUES(?,?)').run(requestId,product);}catch(error){error.code='CONFLICT';throw error;}
  try{return await this.createInvoice(options,{id:requestId,product,key});}
  catch(error){this.db.prepare('DELETE FROM payment_requests WHERE request=? AND invoice IS NULL').run(requestId);throw error;}
 }
 invoice(id){
  const query=this.db.prepare('SELECT id,address,amount,resource,created,expires,minconf FROM invoices WHERE id=?');query.setReadBigInts(true);const row=query.get(id);
  if(!row)throw new Error('Invoice not found');
  return {id:row.id,address:row.address,amount:formatBloz(row.amount),amountRex:row.amount.toString(),resource:row.resource,createdAt:Number(row.created),expiresAt:Number(row.expires),confirmations:Number(row.minconf)};
 }
 check(id){
  const task=(this.checks.get(id)??Promise.resolve()).catch(()=>{}).then(()=>this.inspect(id)).then(result=>{this.onStatus?.(result);return result;});
  this.checks.set(id,task);task.finally(()=>{if(this.checks.get(id)===task)this.checks.delete(id);}).catch(()=>{});return task;
 }
 async inspect(id){
  const invoice=this.invoice(id);let snapshot;
  try{snapshot=await this.provider.snapshot(invoice.address);}catch{return {...invoice,status:'unavailable',access:false};}
  const now=this.clock();
  if(!snapshot?.complete||snapshot.genesisHash!==this.genesisHash||!Number.isSafeInteger(snapshot.checkedAt)||snapshot.checkedAt>now||now-snapshot.checkedAt>this.maxAgeMs||!Number.isSafeInteger(snapshot.tipHeight)||snapshot.tipHeight<0||!Array.isArray(snapshot.outputs))return {...invoice,status:'unavailable',access:false};
  const parsed=[],seen=new Set();
  try{for(const output of snapshot.outputs){
   if(!/^[a-f0-9]{64}:(0|[1-9][0-9]{0,9})$/.test(output.outpoint)||Number(output.outpoint.split(':')[1])>4294967295||seen.has(output.outpoint)||typeof output.amountRex!=='string'||!/^\d+$/.test(output.amountRex)||typeof output.coinbase!=='boolean'||(output.height!==null&&(!Number.isSafeInteger(output.height)||output.height<0||output.height>snapshot.tipHeight)))throw new Error('Invalid snapshot');
   seen.add(output.outpoint);const value=BigInt(output.amountRex);if(value>MAX_REX)throw new Error('Invalid amount');parsed.push({...output,value});
  }}catch{return {...invoice,status:'unavailable',access:false};}
  let detected=0n,confirmed=0n,late=0n;const depths=[];
  this.db.exec('BEGIN IMMEDIATE');
  try{for(const output of parsed){
   if(output.coinbase)continue;
   this.db.prepare('INSERT OR IGNORE INTO observations VALUES(?,?,?)').run(id,output.outpoint,now);
   const first=this.db.prepare('SELECT firstseen FROM observations WHERE invoice=? AND outpoint=?').get(id,output.outpoint).firstseen;
   if(first>=invoice.expiresAt){late+=output.value;continue;}
   detected+=output.value;depths.push({value:output.value,depth:output.height===null?0:snapshot.tipHeight-output.height+1});
   if(output.height!==null&&snapshot.tipHeight-output.height+1>=invoice.confirmations)confirmed+=output.value;
  }this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  const required=BigInt(invoice.amountRex),paid=confirmed>=required;
  let covered=0n,paymentConfirmations=null;for(const part of depths.sort((a,b)=>b.depth-a.depth)){covered+=part.value;if(covered>=required){paymentConfirmations=part.depth;break;}}
  const status=paid?'paid':detected>=required?'confirming':now>=invoice.expiresAt?'expired':detected>0n?'partial':'awaiting';
  return {...invoice,status,access:paid,paymentConfirmations,detectedRex:detected.toString(),confirmedRex:confirmed.toString(),lateRex:late.toString(),overpaidRex:(confirmed>required?confirmed-required:0n).toString()};
 }
 async authorize(id,token,resource){
  return (await this.authorizationDetails(id,token,resource)).authorized;
 }
 async authorizationDetails(id,token,resource){
  if(typeof token!=='string'||token.length>200)return {authorized:false,status:'denied'};
  const row=this.db.prepare('SELECT tokenhash,resource FROM invoices WHERE id=?').get(id);
  if(!row||row.resource!==resource||!timingSafeEqual(digest(token),row.tokenhash))return {authorized:false,status:'denied'};
  const result=await this.check(id);return {authorized:result.access,status:result.status,paymentConfirmations:result.paymentConfirmations??null,confirmations:result.confirmations};
 }
 close(){this.db.close();}
}
