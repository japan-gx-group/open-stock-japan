// 二要素認証の設定（アカウント設定・組織の設定）で、画面と Server Action が受け渡す型。
// Server Action のファイル（'use server'）は async 関数しか export できないため、型はここに置く。

/** 登録してある機器（認証アプリ）。確認済みのものだけを画面に出す */
export interface MfaFactorSummary {
  id: string;
  /** 登録のときに付けた名前 */
  name: string;
  /** 登録した日時（ISO 8601）。分からなければ null */
  createdAt: string | null;
}

export interface MfaOverview {
  factors: MfaFactorSummary[];
  /** 組織の設定で、この人のロールに二要素認証が必須になっている */
  required: boolean;
  /** 登録できる機器の数の上限 */
  maxFactors: number;
}

/** 登録の途中で画面に見せる情報。secret は認証アプリに登録するための値で、登録が済んだら二度と表示しない */
export interface MfaEnrollment {
  factorId: string;
  /** QR コード（SVG の data URL。img の src に入れる） */
  qrCode: string;
  /** QR コードを読めないときに、認証アプリへ手で入力する値 */
  secret: string;
}

/** 組織のセキュリティの設定（「セキュリティ」カード） */
export interface SecurityPolicy {
  /** 社内のアカウントに二要素認証を必須にする */
  requireMfaForInternal: boolean;
  /** いま見ている人が設定を変えられるか（管理者） */
  canEdit: boolean;
  /** いま見ている人が、自分の二要素認証を登録済みか（必須にする前に確かめる） */
  viewerHasMfa: boolean;
  /** 社内のアカウントのうち、二要素認証を登録済みの人数と全体の人数（管理者にだけ返す） */
  internalMfaCount: { enrolled: number; total: number } | null;
}
