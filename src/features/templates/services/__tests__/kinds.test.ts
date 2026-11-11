import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESOURCES, TEMPLATE_KINDS } from '@/lib/resources/definitions';
import { extractPlaceholders } from '../fill';
import { getTemplateKind, isTemplateKindId, kindsOfCategory, meetingKindsFor, scopesOfKind, TEMPLATE_CATEGORIES, TEMPLATE_KIND_DEFS } from '../kinds';
import { findPlaceholder } from '../placeholders';

describe('テンプレートの種類', () => {
  it('リソース定義の種類と、DB の check 制約の種類が同じ', () => {
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261111000008_document_templates.sql'), 'utf8');
    const check = sql.match(/constraint document_templates_kind_check\s+check \(kind in \(([^)]+)\)\)/);
    const inSql = [...(check?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(inSql).toEqual(TEMPLATE_KINDS.map((kind) => kind.value));
  });

  it('文面の上限は、リソース定義（80,000 字）が DB の制約（100,000 字）以下', () => {
    const body = RESOURCES['document-templates'].fields.find((field) => field.key === 'body');
    expect(body?.maxLength).toBe(80_000);
  });

  it('すべての種類が、どれかの分類に入っている', () => {
    const inCategories = TEMPLATE_CATEGORIES.flatMap((category) => kindsOfCategory(category.value).map((kind) => kind.id));
    expect([...inCategories].sort()).toEqual(TEMPLATE_KINDS.map((kind) => kind.value).sort());
  });

  it('知らない種類・Object の組み込みの名前は、種類として扱わない', () => {
    expect(isTemplateKindId('shareholder_notice')).toBe(true);
    expect(isTemplateKindId('toString')).toBe(false);
    expect(isTemplateKindId(null)).toBe(false);
  });

  it('AI への指示の中で例に挙げている差し込み項目は、その種類で使える名前だけ', () => {
    for (const kind of TEMPLATE_KIND_DEFS) {
      const scopes = scopesOfKind(kind);
      for (const name of extractPlaceholders(kind.instruction ?? '')) {
        const def = findPlaceholder(name);
        expect(def && scopes.includes(def.scope), `${kind.id}: {{${name}}}`).toBe(true);
      }
    }
  });

  it('契約書は、AI には書かせない（手元の文面からの取り込みだけ）', () => {
    expect(getTemplateKind('convertible_contract').instruction).toBeNull();
    // ほかの転換型証券の種類でも、契約書・発行要項の条文は書かせない
    for (const kind of kindsOfCategory('convertible')) {
      if (kind.instruction) expect(kind.instruction, kind.id).toContain('J-KISS の投資契約書・発行要項の条文は書かない');
    }
  });

  it('投資家 1 名ずつ作る種類だけ、投資家の差し込み項目が使える', () => {
    expect(scopesOfKind(getTemplateKind('convertible_payment_notice'))).toContain('investment');
    expect(scopesOfKind(getTemplateKind('convertible_terms'))).not.toContain('investment');
    expect(scopesOfKind(getTemplateKind('shareholder_minutes'))).toEqual(['company', 'meeting', 'shareholder_meeting']);
  });
});

describe('meetingKindsFor', () => {
  it('会議の種類・手順・書面決議かどうかで、使えるテンプレートの種類が決まる', () => {
    expect(meetingKindsFor(false, 'notice', false)).toEqual(['shareholder_notice']);
    expect(meetingKindsFor(false, 'notice', true)).toEqual(['shareholder_written_proposal']);
    expect(meetingKindsFor(false, 'minutes', false)).toEqual(['shareholder_minutes']);
    expect(meetingKindsFor(false, 'minutes', true)).toEqual(['shareholder_written_minutes']);
    expect(meetingKindsFor(true, 'notice', false)).toEqual(['board_notice']);
    expect(meetingKindsFor(true, 'minutes', true)).toEqual(['board_written_minutes']);
  });
});
