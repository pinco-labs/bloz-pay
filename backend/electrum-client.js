// SPDX-License-Identifier: GPL-2.0-or-later
import tls from 'node:tls';
const READ_ONLY=new Set(['server.version','server.features','blockchain.headers.subscribe','blockchain.block.header','blockchain.scripthash.get_history','blockchain.transaction.get','blockchain.transaction.get_merkle']);
export class ElectrumClient {
 constructor({host,port=50002,timeoutMs=8000}){
  this.pending=new Map();this.counter=0;this.buffer='';this.closed=false;
  this.socket=tls.connect({host,port,servername:host,rejectUnauthorized:true});
  this.ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{reject(new Error('Electrum TLS timeout'));this.close()},timeoutMs);this.socket.once('secureConnect',()=>{clearTimeout(timer);resolve()});this.socket.once('error',e=>{clearTimeout(timer);reject(e)})});
  this.timeoutMs=timeoutMs;this.socket.on('error',e=>this.fail(e));this.socket.on('close',()=>this.fail(new Error('Electrum disconnected')));
  this.socket.on('data',data=>{
   this.buffer+=data.toString('utf8');if(Buffer.byteLength(this.buffer)>4*1024*1024){this.fail(new Error('Electrum response too large'));this.close();return;}
   let newline;while((newline=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);let message;
    try{message=JSON.parse(line)}catch{this.fail(new Error('Invalid Electrum JSON'));this.close();return;}
    const task=this.pending.get(message.id);if(!task)continue;this.pending.delete(message.id);clearTimeout(task.timer);
    if(message.error||!Object.hasOwn(message,'result'))task.reject(new Error('Electrum query rejected'));else task.resolve(message.result);
   }
  });
 }
 fail(error){this.closed=true;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(error)}this.pending.clear();}
 async call(method,params=[]){
  if(!READ_ONLY.has(method))throw new Error('Electrum method not allowed');await this.ready;if(this.closed)throw new Error('Electrum connection closed');
  const id=++this.counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Electrum query timeout'));this.close()},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});this.socket.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 }
 close(){this.fail(new Error('Electrum closed'));this.socket.destroy();}
}
