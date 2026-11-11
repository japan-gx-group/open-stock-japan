// 認証機能（初回登録ウィザード / 招待リンク）で使う型。
// Server Action ファイル（'use server'）は「async 関数のみ」しか export できないため、
// 型はこの通常モジュールに分離して置く。

// 初期セットアップ（/signup）を実行してよいかの判定結果。
//
// 'unknown' を 'completed' と分けているのは運用のため。判定に失敗した場合も
// 「実行させない」点は 'completed' と同じだが、原因が全く違う:
//   - 'completed' … 正常。もうセットアップ済みなのでログインすればよい
//   - 'unknown'   … 異常。Supabase に繋がらない / SUPABASE_SERVICE_ROLE_KEY が未設定など
// これを同じ扱いにすると、新規環境の構築時に「設定ミスで繋がっていないだけ」なのに
// 「セットアップ済みです」と案内され、原因に辿り着けなくなる。
export type SetupState = 'pending' | 'completed' | 'unknown';

// 初回登録ウィザードが最終的にサーバへ渡す入力一式。
export interface SignupInput {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
  /** セットアップ用の合言葉（環境変数 SETUP_TOKEN を設定している環境でだけ必要） */
  setupToken?: string;
}

// 初回の登録に、セットアップ用の合言葉（環境変数 SETUP_TOKEN）がどう関わるか（services/setup.ts の getSetupTokenStatus）。
export type SetupTokenStatus = 'not_required' | 'required' | 'missing';

export const SETUP_TOKEN_MISSING_MESSAGE =
  '初回の登録には、サーバの環境変数 SETUP_TOKEN（16 文字以上の乱数）の設定が必要です。設定してアプリを起動し直してから、もう一度開いてください';

// 招待リンクの受け取り側（/invite/[token]）でユーザーが入力する項目。
export interface AcceptInviteInput {
  token: string;
  fullName: string;
  password: string;
}

// 招待画面に表示する情報（メール・組織名は改変不可なので読み取り専用で見せる）。
// 受諾時の権限は、サーバが招待の role を profiles に写して決める。ここの isShareholder は画面の文言と、
// 登録後の行き先（株主は株主ポータル）を決めるためだけに使う。
export interface InviteInfo {
  email: string;
  organizationName: string;
  isShareholder: boolean;
}

// Server Action の戻り値。例外を投げず、成否を値で返して画面側で扱いやすくする。
// （features/settings の Server Action とも共有するため、共有型へ移動して再エクスポート）
export type { ActionResult } from '@/types/actionResult';
