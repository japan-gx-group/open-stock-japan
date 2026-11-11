// ログイン・初回登録・招待・二要素認証の成功後に進む先を、外部サイトへの誘導（オープンリダイレクト）を防いで決める。
//
// ?next= は、だれでも好きな値を付けたリンクを作れる。ここを通さずに遷移に使うと、ログインの直後に
// 攻撃者のサイトへ送られる。パスワードの再設定リンクと組み合わせると、URL に付いたセッションの情報ごと
// 外部へ出てしまう。遷移に使う値は、必ず toSafeInternalPath を通したものにすること。

// 解釈のための仮の起点。実在しないドメイン（.invalid は予約済み）にして、入力がここ以外を指したら弾く
const PARSE_BASE = 'http://openstock.invalid';

// 制御文字（タブ・改行など）とバックスラッシュ。ブラウザは URL の中のタブ・改行を取り除き、バックスラッシュを
// '/' と読み替えるので、'/<タブ>/evil.example' や '/\evil.example' は '//evil.example'（外部サイト）になる。
// eslint-disable-next-line no-control-regex -- 制御文字そのものを弾くための検査
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

/**
 * 同じサイトの中のパス（'/' から始まるパス + クエリ）だけを通す。通せない値は null。
 * 返すのは解釈し直した値で、入力の文字列そのものではない（'#…' は落とす）。
 */
export const toSafeInternalPath = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || value === '') return null;
  if (UNSAFE_CHARACTERS.test(value)) return null;
  // 先頭は 1 つの '/' だけ。'//evil.example' はプロトコルを省いた外部の URL
  if (!value.startsWith('/') || value.startsWith('//')) return null;

  let url: URL;
  try {
    url = new URL(value, PARSE_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_BASE) return null;
  // '/.//evil.example' のように、解釈のあとで '//' から始まる形になるものも弾く
  if (url.pathname.startsWith('//')) return null;
  return `${url.pathname}${url.search}`;
};

// ?next= が同じサイトの中のパスならそれを、そうでなければ /dashboard を返す。
// ログイン・初回登録・招待の 3 画面と、メールのリンクからの戻り（/auth/callback）で使う。
export const getSafeRedirectPath = (nextPath: string | null): string => toSafeInternalPath(nextPath) ?? '/dashboard';

// 二要素認証の画面（/mfa・/mfa/setup）から、済んだあとに進む先を決める。
// ?next= が同じサイトの中のパスならそれを、無ければロールごとの最初の画面（株主ロールは株主ポータル）を返す。
// 認証の画面そのもの（/mfa・/login など）へは戻さない（行き来が止まらなくなるため）。
// allowSetup = true のときだけ、設定の画面（/mfa/setup）へ進むのを許す（コードの確認のあとに設定を開く場合）。
export const getPostMfaPath = (
  nextPath: string | null,
  isShareholderRole: boolean,
  { allowSetup = false }: { allowSetup?: boolean } = {},
): string => {
  const home = isShareholderRole ? '/external-portal' : '/dashboard';
  const safePath = toSafeInternalPath(nextPath);
  if (!safePath) {
    return home;
  }
  const pathname = safePath.split('?')[0];
  if (pathname === '/mfa/setup') {
    return allowSetup ? '/mfa/setup' : home;
  }
  if (pathname === '/mfa' || pathname.startsWith('/mfa/') || pathname === '/login') {
    return home;
  }
  return safePath;
};
