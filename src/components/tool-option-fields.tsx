import { categoryCode, toolCategories, toolDepartments } from '@/lib/tool-options';

const selectClass = 'min-w-0 w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm';
export function CategoryField({ value = '', required = false }: { value?: string; required?: boolean }) {
 return <label className="grid gap-1 text-sm">カテゴリー<select name="category" required={required} defaultValue={categoryCode(value) ?? ''} className={selectClass}>
  <option value="">{required ? '選択してください' : 'すべて'}</option>
  {toolCategories.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
 </select></label>;
}
export function DepartmentField({ value = '' }: { value?: string }) {
 return <label className="grid gap-1 text-sm">部門<select name="department" defaultValue={value} className={selectClass}>
  <option value="">未設定</option>
  {toolDepartments.map(department => <option key={department} value={department}>{department}</option>)}
 </select></label>;
}
