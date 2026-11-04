import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { databaseFixture } from './helpers/database';
import { MastersService } from '../src/lib/masters/service';
import { InventoryService } from '../src/lib/inventory/service';
import { AuthError } from '../src/lib/auth/service';

let f: Awaited<ReturnType<typeof databaseFixture>>, masters: MastersService, service: InventoryService, seq = 0;
const status = (n:number) => (error:unknown) => error instanceof AuthError && error.status === n;
const token = (role='ADMIN') => f.tokens[role];
before(async()=>{f=await databaseFixture('inventory_test');masters=new MastersService(f.db);service=new InventoryService(f.db);});
after(async()=>{await f?.close();});
async function stock(on_hand=10,reserved=0){
 const n=++seq;
 const tool=await masters.createTool(token(),{tool_code:'INV-'+n,name:'架空ドリル'+n,category:'DRILL',unit:'本'});
 const location=await masters.createMaster(token(),'locations',{location_code:'SHELF-'+n,name:'架空棚'});
 const machine=await masters.createMaster(token(),'machines',{machine_code:'MC-'+n,name:'架空設備'});
 await masters.registerInitialStock(token(),tool.id,{location_id:location.id,quantity:on_hand,request_key:randomUUID()});
 if(reserved)await f.db.stockBalance.update({where:{tool_id_location_id:{tool_id:tool.id,location_id:location.id}},data:{reserved}});
 return {tool,location,machine};
}
type FixtureStock=Awaited<ReturnType<typeof stock>>;
const issueInput=(s:FixtureStock,quantity=1)=>({tool_id:s.tool.id,location_id:s.location.id,machine_id:s.machine.id,quantity,request_key:randomUUID()});
const balance=(s:FixtureStock)=>f.db.stockBalance.findUniqueOrThrow({where:{tool_id_location_id:{tool_id:s.tool.id,location_id:s.location.id}}});

test('出庫はセッションの操作者で残高・履歴・監査を一体保存する',async()=>{
 const s=await stock(10,2);
 const result=await service.issue(token('WORKER'),{...issueInput(s,3),actor_user_id:f.users.ADMIN,reserved:0});
 assert.equal(result.type,'ISSUE');assert.equal(result.quantity,-3);assert.equal(result.actor_user_id,f.users.WORKER);
 assert.equal(result.on_hand_before,10);assert.equal(result.on_hand_after,7);assert.equal(result.reserved,2);
 assert.equal((await balance(s)).on_hand,7);assert.equal((await balance(s)).reserved,2);
 assert.equal(await f.db.auditLog.count({where:{action:'INVENTORY_MUTATION',entity_id:result.id}}),1);
 const detail=await service.historyDetail(token('WORKER'),result.id);
 assert.equal(detail.confirmation?.on_hand_after,7);
});

test('2人の同時出庫ではavailableを超える片方だけ拒否し負在庫にしない',async()=>{
 const s=await stock(10,2);
 const results=await Promise.allSettled([service.issue(token('WORKER'),issueInput(s,6)),service.issue(token('STOCK_MANAGER'),issueInput(s,6))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected'&&status(409)(rejected.reason));
 assert.equal((await balance(s)).on_hand,4);assert.equal((await balance(s)).reserved,2);
 assert.equal(await f.db.inventoryTransaction.count({where:{tool_id:s.tool.id,type:'ISSUE'}}),1);
});

test('同キーの同時再送は同じ確定結果となり、異内容・別操作者・別操作・別工具への転用を拒否',async()=>{
 const s=await stock(),other=await stock(),input={...issueInput(s,2),reason:'架空作業'};
 const [first,replay]=await Promise.all([service.issue(token('ADMIN'),input),service.issue(token('ADMIN'),input)]);
 assert.deepEqual(replay,first);
 await service.receive(token(),{tool_id:s.tool.id,location_id:s.location.id,quantity:1,reason:'別入庫',request_key:randomUUID()});
 assert.deepEqual(await service.issue(token(),input),first);
 for(const changed of [{...input,quantity:3},{...input,reason:'変更'},{...input,tool_id:other.tool.id},{...input,machine_id:other.machine.id}])await assert.rejects(service.issue(token(),changed),status(409));
 await assert.rejects(service.issue(token('STOCK_MANAGER'),input),status(409));
 await assert.rejects(service.receive(token(),{...input,reason:'架空作業'}),status(409));
 assert.equal(await f.db.inventoryTransaction.count({where:{tool_id:s.tool.id,type:'ISSUE'}}),1);
});

test('同じキーを別工具へ同時利用しても一度しか成立しない',async()=>{
 const a=await stock(),b=await stock(),request_key=randomUUID();
 const results=await Promise.allSettled([service.issue(token('WORKER'),{...issueInput(a),request_key}),service.issue(token('STOCK_MANAGER'),{...issueInput(b),request_key})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected'&&status(409)(rejected.reason));
});

test('出庫は設備必須・有効対象必須、在庫不足と未登録棚を拒否',async()=>{
 const s=await stock(3,1);
 await assert.rejects(service.issue(token('WORKER'),{...issueInput(s),machine_id:undefined}),status(400));
 await assert.rejects(service.issue(token('WORKER'),issueInput(s,3)),status(409));
 const shelf=await masters.createMaster(token(),'locations',{location_code:'EMPTY-'+(++seq),name:'未登録棚'});
 await assert.rejects(service.issue(token('WORKER'),{...issueInput(s),location_id:shelf.id}),status(409));
 await f.db.machine.update({where:{id:s.machine.id},data:{active:false}});
 await assert.rejects(service.issue(token('WORKER'),issueInput(s)),status(409));
 await f.db.machine.update({where:{id:s.machine.id},data:{active:true}});
 await f.db.location.update({where:{id:s.location.id},data:{active:false}});
 await assert.rejects(service.issue(token('WORKER'),issueInput(s)),status(409));
 await f.db.location.update({where:{id:s.location.id},data:{active:true}});
 await f.db.tool.update({where:{id:s.tool.id},data:{active:false}});
 await assert.rejects(service.issue(token('WORKER'),issueInput(s)),status(409));
});

test('数量・理由・IDの型と整数範囲を検証する',async()=>{
 const s=await stock();
 for(const quantity of [0,-1,0.5,'1e2','',true,'2147483648'])await assert.rejects(service.issue(token('WORKER'),{...issueInput(s),quantity}),status(400));
 for(const reason of ['', ' ', 'x'.repeat(501), false])await assert.rejects(service.receive(token(),{...issueInput(s),reason}),status(400));
 await assert.rejects(service.issue(token('WORKER'),{...issueInput(s),tool_id:'bad'}),status(400));
 await assert.rejects(service.issue(token('WORKER'),{...issueInput(s),request_key:'bad'}),status(400));
 await assert.rejects(service.receive(token(),{...issueInput(s),reason:'架空',order_id:randomUUID()}),status(400));
 await assert.rejects(service.reverse(token(),{transaction_id:randomUUID(),reason:'架空',request_key:randomUUID()}),status(404));
});

test('手動入庫は未登録棚を作成し、同じ棚への同時入庫と再送で正しく加算する',async()=>{
 const s=await stock(0);
 const shelf=await masters.createMaster(token(),'locations',{location_code:'RECEIVE-'+(++seq),name:'入庫先'});
 const input={tool_id:s.tool.id,location_id:shelf.id,quantity:3,reason:'架空追加',request_key:randomUUID()};
 const [a]=await Promise.all([service.receive(token('ADMIN'),input),service.receive(token('STOCK_MANAGER'),{...input,quantity:4,request_key:randomUUID()})]);
 assert.deepEqual(await service.receive(token(),input),a);
 const row=await f.db.stockBalance.findUniqueOrThrow({where:{tool_id_location_id:{tool_id:s.tool.id,location_id:shelf.id}}});
 assert.equal(row.on_hand,7);assert.equal(row.reserved,0);
 assert.equal(await f.db.inventoryTransaction.count({where:{tool_id:s.tool.id,location_id:shelf.id,type:'RECEIVE'}}),2);
});

test('加算の整数上限を超えず、失敗したキーを内容そのままで再利用できる',async()=>{
 const s=await stock(2147483647),input={...issueInput(s,1),reason:'架空補充'};
 await assert.rejects(service.receive(token(),input),status(409));
 assert.equal((await balance(s)).on_hand,2147483647);
 await service.issue(token('WORKER'),issueInput(s,1));
 const result=await service.receive(token(),input);assert.equal(result.on_hand_after,2147483647);
});

test('棚卸は実棚数との差分を保存し、同内容再送、期待値違い、差分0、引当割れを区別',async()=>{
 const s=await stock(10,2);
 const input={tool_id:s.tool.id,location_id:s.location.id,counted_quantity:8,expected_on_hand:10,expected_reserved:2,reason:'架空棚卸',request_key:randomUUID()};
 const first=await service.adjust(token(),input);assert.equal(first.quantity,-2);assert.equal(first.type,'ADJUSTMENT');
 assert.deepEqual(await service.adjust(token(),input),first);
 await assert.rejects(service.adjust(token(),{...input,request_key:randomUUID()}),status(409));
 await assert.rejects(service.adjust(token(),{...input,counted_quantity:8,expected_on_hand:8,request_key:randomUUID()}),status(409));
 await assert.rejects(service.adjust(token(),{...input,counted_quantity:1,expected_on_hand:8,request_key:randomUUID()}),status(409));
 await assert.rejects(service.adjust(token(),{...input,counted_quantity:7,expected_on_hand:8,expected_reserved:0,request_key:randomUUID()}),status(409));
 const next=await service.adjust(token(),{...input,counted_quantity:12,expected_on_hand:8,request_key:randomUUID()});assert.equal(next.quantity,4);
 const zero=await stock(3);const empty=await service.adjust(token(),{...input,tool_id:zero.tool.id,location_id:zero.location.id,counted_quantity:0,expected_on_hand:3,expected_reserved:0,request_key:randomUUID()});assert.equal(empty.on_hand_after,0);
});

test('逆取引は元履歴を保持して逆符号・元設備・訂正者・理由を記録し、二重取消を拒否',async()=>{
 const s=await stock(),original=await service.issue(token('WORKER'),issueInput(s,3));
 const input={transaction_id:original.id,reason:'設備の選択間違い',request_key:randomUUID()};
 const reversed=await service.reverse(token(),input);
 assert.equal(reversed.quantity,3);assert.equal(reversed.machine_id,s.machine.id);assert.equal(reversed.actor_user_id,f.users.ADMIN);assert.equal(reversed.reverses_id,original.id);
 assert.equal((await balance(s)).on_hand,10);assert.equal((await f.db.inventoryTransaction.findUniqueOrThrow({where:{id:original.id}})).quantity,-3);
 assert.deepEqual(await service.reverse(token(),input),reversed);
 assert.equal((await service.historyDetail(token('WORKER'),original.id)).reversal_id,reversed.id);
 await assert.rejects(service.reverse(token(),{...input,request_key:randomUUID()}),status(409));
 await assert.rejects(service.reverse(token(),{...input,transaction_id:reversed.id,request_key:randomUUID()}),status(409));
});

test('同時の二重取消は片方のみ成功し、消費済み入庫や引当割れの取消を拒否',async()=>{
 const s=await stock(),original=await service.issue(token('WORKER'),issueInput(s,2));
 const results=await Promise.allSettled(['ADMIN','STOCK_MANAGER'].map(role=>service.reverse(token(role),{transaction_id:original.id,reason:'架空訂正',request_key:randomUUID()})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const r=results.find(r=>r.status==='rejected');assert.ok(r?.status==='rejected'&&status(409)(r.reason));
 const small=await stock(0),receipt=await service.receive(token(),{...issueInput(small,5),reason:'架空入庫'});
 await service.issue(token('WORKER'),issueInput(small,4));
 await assert.rejects(service.reverse(token(),{transaction_id:receipt.id,reason:'架空取消',request_key:randomUUID()}),status(409));
 const reserved=await stock(10,2),initial=await f.db.inventoryTransaction.findFirstOrThrow({where:{tool_id:reserved.tool.id,type:'RECEIVE'}});
 await assert.rejects(service.reverse(token(),{transaction_id:initial.id,reason:'初期登録取消',request_key:randomUUID()}),status(409));
});

test('無効化された工具・棚・設備でも過去の逆取引と成功済み再送は許可',async()=>{
 const s=await stock(),input=issueInput(s,2),original=await service.issue(token('WORKER'),input);
 await f.db.tool.update({where:{id:s.tool.id},data:{active:false}});
 await f.db.location.update({where:{id:s.location.id},data:{active:false}});
 await f.db.machine.update({where:{id:s.machine.id},data:{active:false}});
 assert.deepEqual(await service.issue(token('WORKER'),input),original);
 const reversed=await service.reverse(token(),{transaction_id:original.id,reason:'無効化後の訂正',request_key:randomUUID()});
 assert.equal(reversed.on_hand_after,10);
});

test('本人履歴は自分の出庫と管理者によるその逆取引のみで、他人の直指定・操作者指定を拒否',async()=>{
 const s=await stock(),own=await service.issue(token('WORKER'),issueInput(s)),other=await service.issue(token('ADMIN'),issueInput(s));
 const reversed=await service.reverse(token(),{transaction_id:own.id,reason:'架空訂正',request_key:randomUUID()});
 const list=await service.listHistory(token('WORKER'),{tool_id:s.tool.id});
 assert.equal(list.total,2);assert.ok(list.items.some(item=>item.id===own.id));assert.ok(list.items.some(item=>item.id===reversed.id));
 await assert.rejects(service.historyDetail(token('WORKER'),other.id),status(404));
 await assert.rejects(service.listHistory(token('WORKER'),{actor_user_id:f.users.ADMIN}),status(403));
 assert.equal((await service.listHistory(token('PURCHASER'),{tool_id:s.tool.id})).total,4);
 const text=JSON.stringify(await service.historyDetail(token('WORKER'),reversed.id));assert.ok(!text.includes('password_hash'));assert.ok(!text.includes('token_hash'));assert.ok(!text.includes('unit_price'));
 assert.equal((await service.historyOptions(token('WORKER'))).actors.length,1);
});

test('日本時間の日付境界と実在日・期間・種別・ID・ページを検証する',async()=>{
 const s=await stock(0);
 for(const date of ['2026-11-03T14:59:59.999Z','2026-11-03T15:00:00.000Z','2026-11-04T14:59:59.999Z','2026-11-04T15:00:00.000Z'])await f.db.inventoryTransaction.create({data:{tool_id:s.tool.id,location_id:s.location.id,actor_user_id:f.users.WORKER,machine_id:s.machine.id,type:'ISSUE',quantity:-1,idempotency_key:randomUUID(),created_at:new Date(date)}});
 assert.equal((await service.listHistory(token('ADMIN'),{tool_id:s.tool.id,from:'2026-11-04',to:'2026-11-04',type:'ISSUE'})).total,2);
 for(const query of [{from:'2026-02-30'},{from:'2026-11-05',to:'2026-11-04'},{type:'INVALID'},{tool_id:'bad'},{page:'1.5'}])await assert.rejects(service.listHistory(token(),query),status(400));
});

test('履歴は50件単位で同時刻ならID降順、範囲外ページは空',async()=>{
 const s=await stock(0),prefix='10000000-0000-0000-0000-';
 await f.db.inventoryTransaction.createMany({data:Array.from({length:51},(_,i)=>({id:prefix+String(i+1).padStart(12,'0'),tool_id:s.tool.id,location_id:s.location.id,actor_user_id:f.users.WORKER,machine_id:s.machine.id,type:'ISSUE' as const,quantity:-1,idempotency_key:randomUUID(),created_at:new Date('2026-11-01T00:00:00Z')}))});
 const a=await service.listHistory(token(),{tool_id:s.tool.id,type:'ISSUE'}),b=await service.listHistory(token(),{tool_id:s.tool.id,type:'ISSUE',page:2});
 assert.equal(a.total,51);assert.equal(a.items.length,50);assert.equal(a.items[0].id,prefix+'000000000051');assert.equal(b.items[0].id,prefix+'000000000001');
 assert.equal((await service.listHistory(token(),{tool_id:s.tool.id,page:'999999999999'})).items.length,0);
});

test('権限・失効を再送でも確認し購買担当と作業者の管理操作を拒否',async()=>{
 const s=await stock();
 for(const method of ['receive','adjust','reverse'] as const)await assert.rejects(service[method](token('WORKER'),{}),status(403));
 await assert.rejects(service.issue(token('PURCHASER'),issueInput(s)),status(403));
 await assert.rejects(service.listHistory(undefined,{}),status(401));
 const employee_code='INV-TEMP',user=await f.auth.createUser(token(),{employee_code,name:'架空作業者',role:'WORKER',password:f.password});
 const session=(await f.auth.login(employee_code,f.password)).token,input=issueInput(s);await service.issue(session,input);
 await f.auth.updateUser(token(),user.id,{name:'架空',role:'PURCHASER',active:true});
 await assert.rejects(service.issue(session,input),status(401));
 const next=(await f.auth.login(employee_code,f.password)).token;await assert.rejects(service.issue(next,input),status(403));
});

test('監査保存失敗なら残高と取引履歴を全てロールバック',async()=>{
 const s=await stock();
 await f.admin.query("CREATE FUNCTION fail_inventory_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='INVENTORY_MUTATION' THEN RAISE EXCEPTION 'test audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_inventory_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_inventory_audit()");
 try{await assert.rejects(service.issue(token('WORKER'),issueInput(s,3)));assert.equal((await balance(s)).on_hand,10);assert.equal(await f.db.inventoryTransaction.count({where:{tool_id:s.tool.id,type:'ISSUE'}}),0);}
 finally{await f.admin.query('DROP TRIGGER reject_inventory_audit ON audit_logs; DROP FUNCTION fail_inventory_audit()');}
});

test('別工具の入出庫は、他工具のロック待ちに巻き込まれない',async()=>{
 const a=await stock(),b=await stock();
 await f.admin.query('BEGIN');await f.admin.query('SELECT id FROM tools WHERE id=$1 FOR UPDATE',[a.tool.id]);
 let first:Promise<unknown>|undefined;
 try{
  first=service.issue(token('WORKER'),issueInput(a));first.catch(()=>{});
  let waiting=false;
  for(let i=0;i<40;i++){await f.admin.query('SELECT pg_stat_clear_snapshot()');const r=await f.admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%FROM tools%FOR UPDATE%') AS waiting");if(r.rows[0].waiting){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}
  assert.equal(waiting,true,'工具行で待機中の処理が必要');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const result=await Promise.race([service.issue(token('ADMIN'),issueInput(b)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('別工具まで直列化されている')),1500);})]);assert.equal(result.on_hand_after,9);}
  finally{if(timer)clearTimeout(timer);}
 }finally{await f.admin.query('ROLLBACK');await first;}
});

test('管理用更新と入出庫の同時操作は整合し、ロック待ちには安全な409を返す',async()=>{
 const s=await stock();
 await Promise.all([service.issue(token('WORKER'),issueInput(s)),f.auth.updateUser(token(),f.users.ADMIN,{name:'架空管理者更新',role:'ADMIN',active:true})]);
 assert.equal((await balance(s)).on_hand,9);
 await f.admin.query('BEGIN');await f.admin.query('SELECT id FROM tools WHERE id=$1 FOR UPDATE',[s.tool.id]);
 try{await assert.rejects(service.issue(token('WORKER'),issueInput(s)),status(409));assert.equal((await balance(s)).on_hand,9);}
 finally{await f.admin.query('ROLLBACK');}
});
