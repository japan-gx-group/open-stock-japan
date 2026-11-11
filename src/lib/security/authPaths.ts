// 認証系パス（未ログインでもアクセス可）の判定。src/proxy.ts（ミドルウェア）が
// 「未ログインなら /login へ」「ログイン済みなら /dashboard へ」の振り分けに使う。
// サイドバーの出し分けはルートグループ（src/app/(app) と src/app/(auth)）が担うため
// ここでは行わない。ミドルウェアはディレクトリ構成を知らないので、この一覧は
// src/app/(auth)/ 配下の画面と手で一致させる（画面を足したらここも足す）。
export const isAuthPath = (pathname: string): boolean =>
  pathname === '/login' ||
  pathname === '/signup' ||
  pathname === '/forgot-password' ||
  pathname === '/reset-password' ||
  pathname.startsWith('/invite/');

// ログイン不要の共有リンク（/share/<token> とそのダウンロード）。未ログインでも、ログイン中でも開ける
// （認証系ページと違い、ログイン中の人を /dashboard へ送らない）。公開するのは /share/ 配下だけで、
// アクセスの可否はページとルートがトークン（期限・取り消し）で確かめる。
export const isPublicSharePath = (pathname: string): boolean =>
  pathname.startsWith('/share/') && pathname.length > '/share/'.length;

// 未ログインでも呼べる API。ログインの API（POST /api/auth/login）の 1 本だけで、完全一致で限定する
// （startsWith('/api/auth/') にすると、あとで /api/auth/ 配下に足した API まで未ログインで晒してしまう）。
// この API は、送り元（Origin）の確認・失敗の記録・連続失敗時の一時停止を自分で行う。
export const isPublicAuthApiPath = (pathname: string): boolean => pathname === '/api/auth/login';

// 二要素認証の画面（コードの入力 /mfa、登録 /mfa/setup）。「ログインはしているが、二要素認証がまだ」の人が開く。
// 認証系ページ（isAuthPath）には入れない: 入れると、ログイン中の人が /dashboard へ送り返されて入力できず、
// 未ログインの人が素通りしてしまう。ここに挙げたパスは、未ログインなら /login へ、ログイン中ならそのまま通す
// （＝保護対象のふつうのページと同じ扱い）。どの状態の人に何を見せるかは、ページ（サーバ）が決める。
export const isMfaPath = (pathname: string): boolean => pathname === '/mfa' || pathname === '/mfa/setup';

// ログインしていなくても返してよい、決まった名前のファイル（ロゴとアイコン）。
// 以前は「.svg・.png などで終わるパス」をまとめてプロキシの対象外にしていたが、そうすると
// /invite/x.png のような「画像に見えるパス」で届いた操作がプロキシを通らず、ログインの確認も、
// 監査ログ用のヘッダの付け直しも行われなかった。対象外にするのは、ここに並べた名前だけにする。
// public/ や src/app/ にファイルを足したら、ここにも足すこと（足さないと、未ログインではログイン画面へ送られる）。
const PUBLIC_ASSET_PATHS = new Set(['/favicon.ico', '/icon.svg', '/apple-icon.png', '/logo.svg', '/logo-dark.svg', '/logo-mark.svg']);

export const isPublicAssetPath = (pathname: string): boolean => PUBLIC_ASSET_PATHS.has(pathname);

// 死活確認（監視・readiness probe が未ログインで呼ぶ）。完全一致の 1 本だけ。
export const isHealthPath = (pathname: string): boolean => pathname === '/api/health';

// 送り元（Origin）の確認をする対象か。状態を変えうるメソッドで /api/ を呼ぶものすべて。
// CSP の違反報告（ブラウザが自動で送る。送り元が付かないことがある）だけは対象外にし、Route Handler 側で守る。
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const requiresSameOrigin = (method: string, pathname: string, cspReportPath: string): boolean =>
  !SAFE_METHODS.has(method.toUpperCase()) && pathname.startsWith('/api/') && pathname !== cspReportPath;

