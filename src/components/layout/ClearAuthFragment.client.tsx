'use client';

// URL の # から後ろに認証のトークン（access_token・refresh_token）が付いていたら、アドレスバーと履歴から消す。
//
// このアプリは、メールのリンクからの戻りを ?code= で受け取る（PKCE）ので、# に付いたトークンは使わない。
// それでも、認証サービスを直接呼んで作られたリンクを踏むと、「…/dashboard#access_token=…」の形で届くことがある。
// 使わない値でも、アドレスバーに残ると、画面の共有・スクリーンショット・履歴から漏れる。
// ここでは消すだけで、セッションとしては取り込まない。

import { useEffect } from 'react';

const TOKEN_IN_FRAGMENT = /(^#|&)(access_token|refresh_token)=/;

export const ClearAuthFragment = () => {
  useEffect(() => {
    if (TOKEN_IN_FRAGMENT.test(window.location.hash)) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    }
  }, []);
  return null;
};
