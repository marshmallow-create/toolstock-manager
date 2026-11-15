export function needsReorder(onHand:number,onOrder:number,reorderPoint:number):boolean {
 return onHand+onOrder<reorderPoint;
}
