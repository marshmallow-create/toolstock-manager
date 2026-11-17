import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppOrigin } from '../src/lib/auth/origin';

test('明示URL・RenderのHTTPS URL・ローカル既定値を優先順で使用する',()=>{
 assert.equal(resolveAppOrigin({APP_ORIGIN:'https://tools.example.test',RENDER_EXTERNAL_URL:'https://tools.onrender.com'}),'https://tools.example.test');
 assert.equal(resolveAppOrigin({RENDER:'true',RENDER_EXTERNAL_URL:'https://tools.onrender.com'}),'https://tools.onrender.com');
 assert.equal(resolveAppOrigin({}),'http://127.0.0.1:3000');
 assert.equal(resolveAppOrigin({APP_ORIGIN:'http://127.0.0.1:4312'}),'http://127.0.0.1:4312');
});
test('本番環境では設定漏れや危険な公開URLを拒否する',()=>{
 for(const env of [{NODE_ENV:'production'}, {RENDER:'true'}, {RENDER:'true',APP_ORIGIN:'http://tools.example.test'}, {APP_ORIGIN:'https://user:pass@tools.example.test'}, {APP_ORIGIN:'https://tools.example.test/path'}, {APP_ORIGIN:'https://tools.example.test?key=secret'}, {APP_ORIGIN:'file:///tmp/app'}]) assert.throws(()=>resolveAppOrigin(env));
});
