type OriginEnvironment = { APP_ORIGIN?: string; RENDER_EXTERNAL_URL?: string; RENDER?: string; NODE_ENV?: string };
export function resolveAppOrigin(env: OriginEnvironment): string {
 const configured = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
 if (!configured) {
  if (env.RENDER === 'true' || env.NODE_ENV === 'production') throw new Error('APP_ORIGINを設定してください');
  return 'http://127.0.0.1:3000';
 }
 const url = new URL(configured);
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('APP_ORIGINはアクセス元のオリジンだけを指定してください');
 if (env.RENDER === 'true' && url.protocol !== 'https:') throw new Error('Renderの公開URLにはHTTPSを使用してください');
 return url.origin;
}
