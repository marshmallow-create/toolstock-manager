import './globals.css';
export const metadata = { title: 'ToolStock Manager', description: '工具在庫管理・ローカル開発環境' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ja"><body>{children}</body></html>;
}
