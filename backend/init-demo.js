import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
mkdirSync('private',{recursive:true,mode:0o700});
if(existsSync('private/demo.env'))throw new Error('Demo credentials already exist; preserve them and the database');
const api=randomBytes(32).toString('base64url'),receipt=randomBytes(32).toString('hex');
writeFileSync('private/demo.env',`BLOZ_PAY_SIMULATED=1\nBLOZ_PAY_MERCHANT_PORT=8083\nBLOZ_PAY_MERCHANT_KEY=${api}\nBLOZ_PAY_RECEIPT_KEY=${receipt}\n`,{mode:0o600});
writeFileSync('private/wp-config-snippet.php',`<?php\n// Copy definitions into the private wp-config.php of your TEST site.\ndefine('BLOZ_PAY_MERCHANT_URL','http://127.0.0.1:8083');\ndefine('BLOZ_PAY_MERCHANT_KEY','${api}');\ndefine('BLOZ_PAY_WP_RECEIPT_KEY','${randomBytes(32).toString('hex')}');\ndefine('BLOZ_PAY_WP_SITE_ID','${randomBytes(16).toString('hex')}');\n`,{mode:0o600});
console.log('Private demo configuration created in private/. No real funds; never publish these files.');
