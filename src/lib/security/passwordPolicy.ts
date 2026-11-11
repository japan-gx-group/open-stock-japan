// パスワードの決まり（唯一の定義）。ブラウザとサーバの両方から使う（サーバ専用の import を入れないこと）。
//
// 使う場所は「パスワードを設定する」ところだけ: 初期セットアップ・招待の受諾・パスワードの再設定・変更。
// 画面（入力の案内と送信前の確認）と Server Action（サーバでの確認）の両方で同じ関数を呼ぶ。
// ログインでは確かめない（この決まりより前に作られたアカウントが、ログインできなくなるため）。
//
// 同じ内容を認証サービス（Supabase Auth）にも設定する。ここだけ変えても、認証サービスの設定が緩ければ
// 認証サービスの API を直接呼んで弱いパスワードを設定できてしまうので、必ず両方を合わせること。
//   ローカル: supabase/config.toml の [auth] minimum_password_length / password_requirements
//   本番    : Supabase のダッシュボード Authentication > Sign In / Providers > Email の
//             「Minimum password length」と「Password Requirements」

/** 最小の文字数（config.toml の minimum_password_length と同じ） */
export const PASSWORD_MIN_LENGTH = 12;

// bcrypt が扱えるのは 72 バイトまで。認証サービスはこれを超えるパスワードを拒否する
const PASSWORD_MAX_BYTES = 72;

/** 入力欄の下に出す案内（1 行） */
export const PASSWORD_POLICY_HINT = `${PASSWORD_MIN_LENGTH}文字以上で、英字と数字をそれぞれ1文字以上含めてください`;

/** 決まりを満たさないときのメッセージ。認証サービスが弱いパスワードとして拒否したときも、同じ文言を出す */
export const PASSWORD_POLICY_ERROR = `パスワードは${PASSWORD_MIN_LENGTH}文字以上で、英字と数字をそれぞれ1文字以上含めてください`;

export const PASSWORD_TOO_LONG_ERROR = 'パスワードが長すぎます。72バイト（半角で72文字）以内で設定してください';

// 英字は半角の A-Z / a-z、数字は半角の 0-9（config.toml の password_requirements = "letters_digits" と同じ数え方）。
// 全角の英数字はここでは数えない（認証サービスも数えないので、通してしまうと保存の段階で拒否される）。
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /[0-9]/;

/**
 * 新しく設定するパスワードが決まりを満たすかを確かめる。
 * 満たしていれば null、満たしていなければ画面に出すメッセージを返す。
 */
export const validateNewPassword = (password: unknown): string | null => {
  if (typeof password !== 'string') return PASSWORD_POLICY_ERROR;
  // 文字数は、サロゲートペア（絵文字など）を 1 文字として数える
  if ([...password].length < PASSWORD_MIN_LENGTH) return PASSWORD_POLICY_ERROR;
  if (!HAS_LETTER.test(password) || !HAS_DIGIT.test(password)) return PASSWORD_POLICY_ERROR;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return PASSWORD_TOO_LONG_ERROR;
  return null;
};

interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

/** 認証サービスが「弱いパスワード」として拒否したエラーか（error.code = weak_password） */
export const isWeakPasswordError = (error: AuthErrorLike | null | undefined): boolean =>
  error?.code === 'weak_password';

/**
 * パスワードを設定する API（admin.createUser / admin.updateUserById）が返したエラーを、画面に出す文言にする。
 * 弱いパスワードなら決まりの文言、それ以外は呼び出し側が渡した文言。
 */
export const toPasswordSaveErrorMessage = (
  error: AuthErrorLike | null | undefined,
  fallback: string,
): string => (isWeakPasswordError(error) ? PASSWORD_POLICY_ERROR : fallback);
