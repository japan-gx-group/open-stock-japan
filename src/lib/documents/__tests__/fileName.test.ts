import { describe, expect, it, vi } from 'vitest';

// documents/server.ts はサーバ専用のモジュールを読み込むので、ここで使わないものは差し替える
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { withMatchingExtension } from '../server';

// 保存するファイル名の拡張子を、中身から決めた形式に合わせる。
// 形式は中身で判定しているので、名前だけを別の種類にしたファイル（「案内.pdf.bat」など）を保存できてしまう。
// その名前のままダウンロードさせると、受け取った人の端末で、別の種類のファイルとして開かれる。

describe('withMatchingExtension', () => {
  it('拡張子が形式に合っていれば、そのまま', () => {
    expect(withMatchingExtension('定款.pdf', 'application/pdf')).toBe('定款.pdf');
    expect(withMatchingExtension('定款.PDF', 'application/pdf')).toBe('定款.PDF');
    expect(withMatchingExtension('写真.jpeg', 'image/jpeg')).toBe('写真.jpeg');
    expect(withMatchingExtension('写真.JPG', 'image/jpeg')).toBe('写真.JPG');
    expect(withMatchingExtension('名簿.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('名簿.xlsx');
  });

  it('拡張子が形式と違えば、正しい拡張子を後ろに足す（元の名前は消さない）', () => {
    expect(withMatchingExtension('案内.pdf.bat', 'application/pdf')).toBe('案内.pdf.bat.pdf');
    expect(withMatchingExtension('案内.html', 'application/pdf')).toBe('案内.html.pdf');
    expect(withMatchingExtension('invoice.exe', 'image/png')).toBe('invoice.exe.png');
    expect(withMatchingExtension('メモ.csv', 'text/plain')).toBe('メモ.csv.txt');
  });

  it('拡張子が無ければ足す', () => {
    expect(withMatchingExtension('議事録', 'application/pdf')).toBe('議事録.pdf');
  });

  it('知らない形式なら何もしない', () => {
    expect(withMatchingExtension('data.bin', 'application/octet-stream')).toBe('data.bin');
  });
});
