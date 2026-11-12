import { Prisma } from '../../generated/prisma/client';
import { integer } from '../masters/validation';
import { AuthError } from '../auth/service';

export function stockQuantity(quantity: number, unitsPerOrder: number): number {
 integer(quantity,'数量',1);integer(unitsPerOrder,'入数',1);
 const total=quantity*unitsPerOrder;
 if(!Number.isSafeInteger(total)||total>2147483647)throw new AuthError(400,'在庫単位に換算した数量が上限を超えます');
 return total;
}

export function inventoryCost(price: Prisma.Decimal | null, unitsPerOrder: number, signedQuantity: number) {
 integer(unitsPerOrder,'入数',1);
 if(price===null)return {unit_price:null,amount:null};
 // Decimal's default 20 significant digits cannot hold maximum price × quantity.
 const Decimal=Prisma.Decimal.clone({precision:50,rounding:Prisma.Decimal.ROUND_HALF_UP});
 const value=new Decimal(price.toString());
 return {unit_price:new Prisma.Decimal(value.div(unitsPerOrder).toFixed(8)),amount:new Prisma.Decimal(value.mul(signedQuantity).div(unitsPerOrder).toFixed(2))};
}

export function costSnapshot(tool:{unit_price:Prisma.Decimal|null;units_per_order:number;unit:string},quantity:number) {
 return {...inventoryCost(tool.unit_price,tool.units_per_order,quantity),purchase_unit_price:tool.unit_price,cost_units_per_order:tool.units_per_order,stock_unit:tool.unit,cost_basis:'MASTER'};
}
