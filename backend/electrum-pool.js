// SPDX-License-Identifier: GPL-2.0-or-later
import {DatabaseSync} from 'node:sqlite';
import {validatePaymentAddress} from './electrum-address.js';
export class ElectrumAddressPool {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS addresses(address TEXT PRIMARY KEY,reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved IN(0,1))) STRICT;');}
 import(addresses){
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>10000||addresses.some(a=>!validatePaymentAddress(a))||new Set(addresses).size!==addresses.length)throw new Error('Unique valid merchant public addresses required');
  this.db.exec('BEGIN IMMEDIATE');try{for(const address of addresses)this.db.prepare('INSERT OR IGNORE INTO addresses(address) VALUES(?)').run(address);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 reserve(){this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT address FROM addresses WHERE reserved=0 ORDER BY rowid LIMIT 1').get();if(!row)throw new Error('Merchant address pool exhausted');this.db.prepare('UPDATE addresses SET reserved=1 WHERE address=?').run(row.address);this.db.exec('COMMIT');return row.address;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 close(){this.db.close();}
}
