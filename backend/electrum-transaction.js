// SPDX-License-Identifier: GPL-2.0-or-later
import {createHash} from 'node:crypto';
export const sha256=data=>createHash('sha256').update(data).digest();
export const hash256=data=>sha256(sha256(data));
export const displayHash=data=>Buffer.from(data).reverse().toString('hex');
export function header(raw){
 if(typeof raw!=='string'||!/^[a-f0-9]{160}$/.test(raw))throw new Error('Expected standard 80-byte header');
 const bytes=Buffer.from(raw,'hex');return {raw,hash:displayHash(hash256(bytes)),merkle:bytes.subarray(36,68),timestamp:bytes.readUInt32LE(68)*1000};
}
export function parseTransaction(raw){
 if(typeof raw!=='string'||raw.length>2000000||raw.length%2||!/^([a-f0-9]{2})+$/.test(raw))throw new Error('Invalid raw transaction');
 const bytes=Buffer.from(raw,'hex');let offset=0;
 const take=n=>{if(!Number.isSafeInteger(n)||n<0||offset+n>bytes.length)throw new Error('Truncated transaction');const part=bytes.subarray(offset,offset+n);offset+=n;return part;};
 const size=()=>{const first=take(1)[0];if(first<253)return first;const n=first===253?BigInt(take(2).readUInt16LE()):first===254?BigInt(take(4).readUInt32LE()):take(8).readBigUInt64LE();if(n>100000n||(first===253&&n<253n)||(first===254&&n<=65535n)||(first===255&&n<=4294967295n))throw new Error('Invalid CompactSize');return Number(n);};
 const version=take(4);let witness=false;if(bytes[offset]===0){take(1);if(take(1)[0]!==1)throw new Error('Unsupported witness flags');witness=true;}
 const baseStart=offset,inputs=size();if(!inputs||inputs>10000)throw new Error('Invalid input count');let coinbase=false;
 for(let i=0;i<inputs;i++){const prev=take(32),index=take(4).readUInt32LE(),script=take(size());take(4);if(prev.every(b=>b===0)&&index===4294967295){if(inputs!==1||script.length<2||script.length>100)throw new Error('Invalid coinbase');coinbase=true;}}
 const count=size();if(!count||count>10000)throw new Error('Invalid output count');const outputs=[];
 for(let n=0;n<count;n++){const amount=take(8).readBigUInt64LE();if(amount>9223372036854775807n)throw new Error('Invalid output amount');outputs.push({n,amountRex:amount.toString(),script:take(size()).toString('hex')});}
 const baseEnd=offset;let hasWitness=false;
 if(witness)for(let i=0;i<inputs;i++){const count=size();if(count)hasWitness=true;for(let j=0;j<count;j++)take(size());}
 if(witness&&!hasWitness)throw new Error('Superfluous witness serialization');const lock=take(4);if(offset!==bytes.length)throw new Error('Trailing transaction bytes');
 const txid=displayHash(hash256(Buffer.concat([version,bytes.subarray(baseStart,baseEnd),lock])));return {txid,coinbase,outputs};
}
export function verifyMerkle(txid,proof,blockHeader,height){
 if(!proof||proof.block_height!==height||!Number.isSafeInteger(proof.pos)||proof.pos<0||!Array.isArray(proof.merkle)||proof.merkle.length>32)throw new Error('Invalid merkle proof');
 let position=proof.pos,node=Buffer.from(txid,'hex').reverse();
 for(const sibling of proof.merkle){if(typeof sibling!=='string'||!/^[a-f0-9]{64}$/.test(sibling))throw new Error('Invalid merkle sibling');const bytes=Buffer.from(sibling,'hex').reverse();node=hash256(position%2?Buffer.concat([bytes,node]):Buffer.concat([node,bytes]));position=Math.floor(position/2);}
 if(position!==0||!node.equals(blockHeader.merkle))throw new Error('Merkle proof mismatch');return true;
}
