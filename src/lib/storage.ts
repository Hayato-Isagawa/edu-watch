/**
 * 記事データのストレージ層(MVP: リポジトリ内 JSON)
 *
 * `<dataDir>/YYYY-MM-DD.json` に Article[] を保存する。Sprint 2 設計書 §7.1 準拠。
 * Phase 2 で D1 / KV へ移行する想定だが、本層は同じ API(loadDay / loadRange / mergeDay)
 * を維持して差し替え可能にする。
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Article, ArticleList } from "./article-schema.ts";
import type { Article as ArticleType } from "./article-schema.ts";

const FILENAME_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

function fileForDate(dataDir: string, yyyyMmDd: string): string {
  return path.join(dataDir, `${yyyyMmDd}.json`);
}

/** 指定日の記事を読み込む。ファイル不在時は `[]`。 */
export async function loadDay(dataDir: string, yyyyMmDd: string): Promise<ArticleType[]> {
  try {
    const buf = await readFile(fileForDate(dataDir, yyyyMmDd), "utf8");
    return ArticleList.parse(JSON.parse(buf));
  } catch (err: unknown) {
    if (isMissingFile(err)) return [];
    throw err;
  }
}

/**
 * `from` 〜 `to`(両端含む)の保存済み記事を全て読み込む。
 * ディレクトリ走査で `YYYY-MM-DD.json` 形式のファイルだけを対象にする。
 */
export async function loadRange(
  dataDir: string,
  fromDate: string,
  toDate: string,
): Promise<ArticleType[]> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch (err: unknown) {
    if (isMissingFile(err)) return [];
    throw err;
  }
  const targets = entries
    .filter((name) => FILENAME_PATTERN.test(name))
    .map((name) => name.slice(0, 10))
    .filter((d) => d >= fromDate && d <= toDate)
    .sort();

  const all: ArticleType[] = [];
  for (const d of targets) {
    const day = await loadDay(dataDir, d);
    all.push(...day);
  }
  return all;
}

/**
 * 指定日のファイルに記事をマージして書き戻す。
 * 既存ファイルがあれば既存記事 + 新規記事を id ベースで dedupe してから保存する。
 * 並び順は publishedAt 降順(新しい記事が先頭)。
 *
 * dedupe ポリシー(ADR 0010): 既存 id と一致した新規記事はスキップする。
 * collectedAt は初観測時刻で固定し、RSS が同じ記事を再配信しても上書きしない。
 */
export async function mergeDay(
  dataDir: string,
  yyyyMmDd: string,
  newArticles: ArticleType[],
): Promise<{ added: number; total: number }> {
  await mkdir(dataDir, { recursive: true });
  const existing = await loadDay(dataDir, yyyyMmDd);
  const byId = new Map<string, ArticleType>();
  for (const a of existing) byId.set(a.id, a);
  let added = 0;
  for (const a of newArticles) {
    if (byId.has(a.id)) continue;
    byId.set(a.id, a);
    added++;
  }
  const merged = [...byId.values()].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
  const validated = ArticleList.parse(merged);
  await writeFile(
    fileForDate(dataDir, yyyyMmDd),
    JSON.stringify(validated, null, 2) + "\n",
    "utf8",
  );
  return { added, total: validated.length };
}

/**
 * 既存記事の `requiresMembership` フィールドのみ後付けで更新する(ADR 0022)。
 *
 * ADR 0010 では「mergeDay は既存 id をスキップし、後からの更新を一切受け入れない」
 * 方針を採った。本関数はその例外として、`requiresMembership: undefined/false → true`
 * の片方向遷移のみを許容する。public 化後 paywall 化された日教記事の予告精度を
 * 維持するための限定的な後付け更新で、他のフィールド(title / summary / categories
 * など)は一切変更しない。
 *
 * - 入力 `updates` は `{ id → true }` の Map。`true` 以外は受け付けない型で表現
 * - 既に `requiresMembership === true` の記事は no-op(冗長書き込みしない)
 * - 該当 id が当該日付ファイルに存在しない場合は黙ってスキップ
 * - 並び順 / 整形(publishedAt 降順 / 2-space JSON / trailing newline)は `mergeDay` と統一
 * - 戻り値: 実際に書き換わった記事数 + 当該日のファイル総数
 */
export async function applyMembershipUpdates(
  dataDir: string,
  yyyyMmDd: string,
  updates: ReadonlyMap<string, true>,
): Promise<{ changed: number; total: number }> {
  if (updates.size === 0) {
    const existing = await loadDay(dataDir, yyyyMmDd);
    return { changed: 0, total: existing.length };
  }
  const existing = await loadDay(dataDir, yyyyMmDd);
  if (existing.length === 0) return { changed: 0, total: 0 };

  let changed = 0;
  const updated = existing.map((a) => {
    if (updates.has(a.id) && a.requiresMembership !== true) {
      changed++;
      return { ...a, requiresMembership: true as const };
    }
    return a;
  });
  if (changed === 0) return { changed: 0, total: existing.length };

  const sorted = [...updated].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
  const validated = ArticleList.parse(sorted);
  await writeFile(
    fileForDate(dataDir, yyyyMmDd),
    JSON.stringify(validated, null, 2) + "\n",
    "utf8",
  );
  return { changed, total: validated.length };
}

function isMissingFile(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

// 型再エクスポート(消費側で `import { Article } from "./storage.ts"` できると便利)
export { Article };
