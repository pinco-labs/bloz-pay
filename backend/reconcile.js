// Persist scheduling independently of process lifetime; check every eligible invoice fairly.
export class PaymentReconciler {
 constructor({pay,clock=Date.now,batchSize=50}) {
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500)throw new Error('Invalid batch size');
  this.pay=pay;this.clock=clock;this.batchSize=batchSize;this.running=null;
  pay.db.exec('CREATE TABLE IF NOT EXISTS payment_checks(invoice TEXT PRIMARY KEY REFERENCES invoices(id),checked INTEGER NOT NULL) STRICT');
 }
 run(){
  if(this.running)return this.running;
  this.running=this.batch().finally(()=>{this.running=null;});return this.running;
 }
 async batch(){
  const rows=this.pay.db.prepare(`SELECT i.id FROM invoices i LEFT JOIN payment_checks c ON c.invoice=i.id
   WHERE i.expires>? ORDER BY COALESCE(c.checked,0),i.created,i.id LIMIT ?`).all(this.clock()-86400000,this.batchSize);
  let failures=0;
  for(const {id} of rows){
   try{await this.pay.check(id);}catch{failures++;}
   // Even failures take their turn; one broken invoice cannot starve the remainder.
   this.pay.db.prepare('INSERT INTO payment_checks VALUES(?,?) ON CONFLICT(invoice) DO UPDATE SET checked=excluded.checked').run(id,this.clock());
  }
  return {checked:rows.length,failures};
 }
}
