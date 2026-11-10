export function assertBackupTarget(url, published) {
 const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
 const port = url.port || '5432';
 const database = decodeURIComponent(url.pathname.slice(1));
 const endpoint = published.trim().match(/^127\.0\.0\.1:(\d+)$/);
 if (database !== 'toolstock_dev' || host !== '127.0.0.1' || !endpoint || port !== endpoint[1]) {
  throw Error('DATABASE_URLとComposeのDB接続先が一致しません。バックアップを中止しました');
 }
 return { host, port, database };
}
