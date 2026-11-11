const integerPrice = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

/** Round prices for display only; stored amounts retain their decimal precision. */
export const formatPrice = (value: string | number) => integerPrice.format(Number(value));
