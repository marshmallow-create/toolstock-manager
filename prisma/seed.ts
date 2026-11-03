import 'dotenv/config';
import { getDb } from '../src/lib/db';
const db = getDb();
if (process.env.ALLOW_LOCAL_SEED !== 'yes') throw new Error('架空データ投入には ALLOW_LOCAL_SEED=yes を指定してください');
try {
  await db.$transaction(async tx => {
    for (const [employee_code, role, name] of [
      ['A001','WORKER','架空 作業者'], ['S001','STOCK_MANAGER','架空 在庫管理者'],
      ['P001','PURCHASER','架空 購買担当'], ['ADMIN001','ADMIN','架空 管理者'],
    ] as const) await tx.user.upsert({ where: { employee_code }, update: {}, create: { employee_code, role, name } });
    for (const [machine_code,name] of [['FH8800-01','架空マシニングセンタ'],['MC-02','架空MC'],['LATHE-01','架空NC旋盤']])
      await tx.machine.upsert({ where: { machine_code }, update: {}, create: { machine_code,name } });
    for (const location_code of ['A-01','A-02','B-01']) await tx.location.upsert({ where: { location_code }, update: {}, create: { location_code,name: `架空棚 ${location_code}` } });
    const supplier = await tx.supplier.upsert({ where: { supplier_code: 'DEMO-S01' }, update: {}, create: { supplier_code:'DEMO-S01', name:'架空工具商会',email:'demo@example.invalid' } });
    const actor = await tx.user.findUniqueOrThrow({ where: { employee_code:'S001' } });
    const shelf = await tx.location.findUniqueOrThrow({ where: { location_code:'A-01' } });
    const definitions = [['T001','超硬ドリルφ10','DRILL','本'],['T002','超硬エンドミルφ16','END_MILL','本'],['T003','旋削チップCNMG120408','INSERT','個'],['T004','スパイラルタップM8','TAP','本']];
    for (const [tool_code,name,category,unit] of definitions) {
      const tool = await tx.tool.upsert({ where:{tool_code},update:{},create:{tool_code,name,category,unit,manufacturer:'架空メーカー',model:`DEMO-${tool_code}`} });
      await tx.inventoryPolicy.upsert({ where:{tool_id:tool.id},update:{},create:{tool_id:tool.id,safety_stock:5,reorder_point:15,target_stock:30} });
      await tx.supplierItem.upsert({ where:{tool_id_supplier_id:{tool_id:tool.id,supplier_id:supplier.id}},update:{},create:{tool_id:tool.id,supplier_id:supplier.id,supplier_model:`DEMO-${tool_code}`,unit_price:'1250.00',order_multiple:5,lead_time_days:7,preferred:true} });
      const existing = await tx.stockBalance.findUnique({where:{tool_id_location_id:{tool_id:tool.id,location_id:shelf.id}}});
      if (!existing) {
        await tx.stockBalance.create({data:{tool_id:tool.id,location_id:shelf.id,on_hand:20,reserved:0}});
        await tx.inventoryTransaction.create({data:{tool_id:tool.id,location_id:shelf.id,actor_user_id:actor.id,type:'RECEIVE',quantity:20,idempotency_key:`demo-opening-${tool_code}`,reason:'架空の初期在庫'}});
      }
    }
  });
  console.log('架空シード投入完了（既存マスタ・在庫は変更しません）');
} finally { await db.$disconnect(); }
