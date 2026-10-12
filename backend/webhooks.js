import {createHmac,timingSafeEqual} from 'node:crypto';

const signature=(key,timestamp,body)=>createHmac('sha256',key).update(timestamp+'.'+body).digest('hex');
export function verifyWebhook({key,timestamp,body,mac,now=Date.now()}) {
 if(typeof key!=='string'||key.length<32||typeof body!=='string'||!/^\d{10,13}$/.test(timestamp??'')||!/^v1=[a-f0-9]{64}$/.test(mac??''))return false;
 if(Math.abs(now-Number(timestamp)*1000)>300000)return false;
 return timingSafeEqual(Buffer.from(signature(key,timestamp,body),'hex'),Buffer.from(mac.slice(3),'hex'));
}

// Initial deployment supports only a fixed local merchant receiver, no customer URLs.
export class MerchantWebhooks {
 constructor({db,url,key,clock=Date.now,send=fetch}) {
  this.url=new URL(url);
  if(this.url.protocol!=='http:'||this.url.hostname!=='127.0.0.1'||this.url.username||this.url.password||this.url.hash||this.url.search||!/^[-_A-Za-z0-9]{32,200}$/.test(key??''))throw new Error('Fixed loopback webhook URL and independent signing key required');
  this.db=db;this.key=key;this.clock=clock;this.send=send;this.running=null;
  db.exec(`CREATE TABLE IF NOT EXISTS merchant_states(invoice TEXT PRIMARY KEY REFERENCES invoices(id),state TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS merchant_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,invoice TEXT NOT NULL REFERENCES invoices(id),body TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,delivered INTEGER) STRICT;`);
 }
 observe(result) {
  // Delivery of an event never grants content access: authorize still checks the chain.
  const state=JSON.stringify({status:result.status,access:result.access,detectedRex:result.detectedRex??null,confirmedRex:result.confirmedRex??null,lateRex:result.lateRex??null,overpaidRex:result.overpaidRex??null});
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const previous=this.db.prepare('SELECT state FROM merchant_states WHERE invoice=?').get(result.id);
   if(previous?.state!==state){
    const now=this.clock();
    const row=this.db.prepare('INSERT INTO merchant_events(invoice,body,next_attempt) VALUES(?,?,?)').run(result.id,'',now);
    const body=JSON.stringify({version:1,id:String(row.lastInsertRowid),type:'payment.state',createdAt:now,invoiceId:result.id,resource:result.resource,...JSON.parse(state)});
    this.db.prepare('UPDATE merchant_events SET body=? WHERE sequence=?').run(body,row.lastInsertRowid);
    this.db.prepare('INSERT INTO merchant_states VALUES(?,?) ON CONFLICT(invoice) DO UPDATE SET state=excluded.state').run(result.id,state);
   }
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 deliver() {
  if(this.running)return this.running;
  this.running=this.deliverOne().finally(()=>{this.running=null;});return this.running;
 }
 async deliverOne() {
  // Preserve global ordering: a failed head event blocks newer ones until acknowledged.
  const row=this.db.prepare('SELECT * FROM merchant_events WHERE delivered IS NULL ORDER BY sequence LIMIT 1').get();
  if(!row||row.next_attempt>this.clock())return false;
  const timestamp=String(Math.floor(this.clock()/1000));let accepted=false;
  try{
   const response=await this.send(this.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-BlozPay-Timestamp':timestamp,'X-BlozPay-Signature':'v1='+signature(this.key,timestamp,row.body)},body:row.body});
   accepted=response.status>=200&&response.status<300;
   await response.body?.cancel();
  }catch{accepted=false;}
  if(accepted)this.db.prepare('UPDATE merchant_events SET delivered=? WHERE sequence=?').run(this.clock(),row.sequence);
  else this.db.prepare('UPDATE merchant_events SET attempts=attempts+1,next_attempt=? WHERE sequence=?').run(this.clock()+Math.min(3600000,1000*2**Math.min(row.attempts,12)),row.sequence);
  return accepted;
 }
}
