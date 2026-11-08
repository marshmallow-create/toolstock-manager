export const toolCategories = [
 { value: 'DRILL', label: 'ドリル' },
 { value: 'END_MILL', label: 'エンドミル' },
 { value: 'TAP', label: 'タップ' },
 { value: 'REAMER', label: 'リーマ' },
 { value: 'INSERT', label: 'チップ' },
] as const;
export const toolDepartments = ['17314', '17361', '17362', '17363'] as const;
export function categoryCode(value: unknown) {
 if (typeof value !== 'string') return undefined;
 const trimmed = value.trim();
 return toolCategories.find(option => option.value === trimmed.toUpperCase() || option.label === trimmed)?.value;
}
export function categoryLabel(value: string) {
 return toolCategories.find(option => option.value === categoryCode(value))?.label ?? (value || '—');
}
export function categoryAliases(value: string) {
 const option = toolCategories.find(option => option.value === categoryCode(value));
 return option ? [option.value, option.label] : [];
}
