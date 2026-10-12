// SPDX-License-Identifier: GPL-2.0-or-later
const alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
// Restrict the first merchant adapter to lowercase native SegWit v0 keyhash addresses.
export function validatePaymentAddress(address){
 if(typeof address!=='string'||address.length>90||!address.startsWith('bz1')||address!==address.toLowerCase())return false;
 const separator=address.lastIndexOf('1'),hrp=address.slice(0,separator),data=[...address.slice(separator+1)].map(c=>alphabet.indexOf(c));
 if(hrp!=='bz'||data.length<7||data.some(n=>n<0))return false;
 let checksum=1;const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
 for(const value of [...[...hrp].map(c=>c.charCodeAt(0)>>5),0,...[...hrp].map(c=>c.charCodeAt(0)&31),...data]){const top=checksum>>>25;checksum=((checksum&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)checksum^=generators[i];}
 if(checksum!==1||data[0]!==0)return false;
 let accumulator=0,bits=0;const program=[];
 for(const value of data.slice(1,-6)){accumulator=((accumulator<<5)|value)&0xffff;bits+=5;while(bits>=8){bits-=8;program.push((accumulator>>>bits)&255);}}
 return bits<5&&((accumulator<<(8-bits))&255)===0&&program.length===20;
}

export function paymentScript(address){
 if(!validatePaymentAddress(address))throw new Error('Invalid BLOZ native SegWit v0 keyhash address');
 const words=[...address.slice(address.lastIndexOf('1')+2,-6)].map(c=>alphabet.indexOf(c));
 let accumulator=0,bits=0;const program=[];
 for(const word of words){accumulator=((accumulator<<5)|word)&0xffff;bits+=5;while(bits>=8){bits-=8;program.push((accumulator>>>bits)&255)}}
 return '0014'+Buffer.from(program).toString('hex');
}
