import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('WordPress plugin gates private articles, rejects bad nonce/receipt, and hides capabilities', {skip:!process.env.BLOZ_TEST_PHP},()=>{
 const run=scenario=>{
  const result=spawnSync(process.env.BLOZ_TEST_PHP,['-n','-d','extension_dir='+process.env.BLOZ_TEST_PHP_EXT,...(process.platform==='win32'?['-d','extension=openssl']:[]),'test/fixtures/wordpress-pay.php',scenario],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 };
 assert.equal(run('content').data.content,'<p>PRIVATE ARTICLE</p>');
 for(const scenario of ['unpaid','guest','nonce','outage','tampered','internal','chainoutage']){
  const result=run(scenario);assert.equal(result.success,false);assert.equal(JSON.stringify(result).includes('PRIVATE ARTICLE'),false);
 }
 const internal=run('internal');assert.equal(JSON.stringify(internal).includes('PRIVATE_DEBUG_CREDENTIAL'),false);
 const unavailable=run('chainoutage');assert.equal(unavailable.code,503);assert.match(unavailable.data.message,/non inviare un altro pagamento/);
 const order=run('order');assert.equal(order.success,true);assert.equal(order.data.accessToken,undefined);
 assert.equal(JSON.stringify(order).includes('PRIVATE_BACKEND_FIELD'),false);
 const status=run('status');assert.equal(status.data.paymentConfirmations,2);assert.equal(JSON.stringify(status).includes('PRIVATE_BACKEND_FIELD'),false);
 const shortcode=run('shortcode');assert.equal(shortcode.markup.includes('PRIVATE ARTICLE'),false);
 assert.equal(shortcode.type.public,false);assert.equal(shortcode.type.show_in_rest,false);assert.equal(shortcode.type.publicly_queryable,false);
});
