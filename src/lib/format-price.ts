/** Format saved decimal amounts without losing integer precision in Number. */
export function formatMoney(value:string|number) {
 const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
 if(!match)return '—';
 const fraction=match[3]??'';
 let cents=BigInt(match[2])*100n+BigInt(fraction.padEnd(2,'0').slice(0,2));
 if((fraction[2]??'0')>='5')cents++;
 const decimals=String(cents%100n).padStart(2,'0').replace(/0+$/,'');
 return (match[1]&&cents!==0n?'-':'')+new Intl.NumberFormat('ja-JP').format(cents/100n)+(decimals?'.'+decimals:'');
}
const integerPrice = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

/** Round prices for display only; stored amounts retain their decimal precision. */
export const formatPrice = (value: string | number) => integerPrice.format(Number(value));
