// リクエストの送り元（Origin ヘッダ）が、このサイト自身かを確かめる（CSRF の緩和）。
// Cookie のセッションで動く Route Handler のうち、状態を変えるもの（ログイン・退会など）の入口で使う。
// Server Action は Next.js が同じ確認をするので、ここを呼ばなくてよい。

interface RequestLike {
  headers: { get(name: string): string | null };
}

// サイト自身の公開ホスト（Origin の比較相手）を求める。
// 運用者が明示した APP_URL を最優先する（Host 系ヘッダはプロキシ構成次第で書き換わるため）。
// 未設定のセルフホスト環境では x-forwarded-host → host の順で見る。nginx 等のリバースプロキシ
// 越しでは proxy_set_header Host が無いと Host が「localhost:3000」等の内部値になり、
// ブラウザが送る Origin（公開ドメイン）と一致せず常に 403 になるため、素の Host だけを
// 見てはいけない（invites.ts の resolveRequestOrigin と同じ解決順）。
// 判定できない場合は null を返し、呼び出し側で拒否する（fail-closed）。
export const resolveExpectedHost = (request: RequestLike): string | null => {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      return new URL(appUrl).host;
    } catch {
      // APP_URL が不正な形式なら「設定なし」扱いにせず拒否する（設定ミスを黙って緩めない）。
      return null;
    }
  }
  // x-forwarded-host は多段プロキシでカンマ区切りになり得るため先頭だけを使う。
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  return forwardedHost || request.headers.get('host') || null;
};

// Origin がサイト自身の公開ホストと一致するか（クロスサイトからの POST を弾く）。
// ブラウザの fetch(POST) は同一オリジンでも Origin を必ず送るため、欠落・不一致は拒否してよい。
//
// APP_URL が設定されていれば、スキーム（http / https）まで含めて比べる。ホストだけで比べると、
// https のサイトに対して、同じホストの http のページ（暗号化されていない通信に割り込んだ者が出せる）からの
// 送信を通してしまう。APP_URL が無いときは、アプリに届いた時点のスキームを確実には知れない
// （プロキシの後ろでは常に http で届く）ので、ホストだけで比べる。
export const isSameOriginRequest = (request: RequestLike): boolean => {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      return originUrl.origin === new URL(appUrl).origin;
    } catch {
      return false;
    }
  }

  const expectedHost = resolveExpectedHost(request);
  return expectedHost !== null && originUrl.host === expectedHost;
};
