/**
 * `applyMembershipUpdates` の挙動検証スクリプト(ADR 0022)
 *
 * 使い方: `npm run check:membership-updates`
 *
 * 一時ディレクトリに合成 article JSON を書き出し、`applyMembershipUpdates` の
 * 主要パスを assert する:
 *   1. 該当 id を `false / undefined → true` に更新する
 *   2. 既に `true` の id は no-op(changed カウントに含めない)
 *   3. 該当 id がファイルに存在しない場合は無視
 *   4. 並び順(publishedAt 降順)が保持される
 *   5. 他フィールド(title / summary / categories)が変更されない
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMembershipUpdates } from "../src/lib/storage.ts";
import type { Article } from "../src/lib/article-schema.ts";

const FIXTURES: Article[] = [
  {
    id: "nikkyo-2026-04-22-1111111111111111",
    title: "古い記事(undefined)",
    sourceId: "nikkyo",
    sourceName: "日本教育新聞",
    sourceUrl: "https://www.kyoiku-press.com/post-1/",
    publishedAt: "2026-04-22T08:00:00+09:00",
    collectedAt: "2026-04-22T22:00:00+09:00",
    summary: "summary 1",
    categories: ["政策・制度"],
    layer: 2,
    language: "ja",
  },
  {
    id: "nikkyo-2026-04-22-2222222222222222",
    title: "新しい記事(undefined)",
    sourceId: "nikkyo",
    sourceName: "日本教育新聞",
    sourceUrl: "https://www.kyoiku-press.com/post-2/",
    publishedAt: "2026-04-22T18:00:00+09:00",
    collectedAt: "2026-04-22T22:00:00+09:00",
    summary: "summary 2",
    categories: ["教員・働き方"],
    layer: 2,
    language: "ja",
  },
  {
    id: "nikkyo-2026-04-22-3333333333333333",
    title: "既に true の記事",
    sourceId: "nikkyo",
    sourceName: "日本教育新聞",
    sourceUrl: "https://www.kyoiku-press.com/post-3/",
    publishedAt: "2026-04-22T12:00:00+09:00",
    collectedAt: "2026-04-22T22:00:00+09:00",
    categories: ["研究・エビデンス"],
    layer: 2,
    language: "ja",
    requiresMembership: true,
  },
];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "edu-watch-recheck-test-"));
  try {
    const date = "2026-04-22";
    const file = path.join(dir, `${date}.json`);
    // 並び順は publishedAt 降順前提だが、保存時にソートされることも検証するため
    // あえて非ソート順で書き出す
    await writeFile(file, JSON.stringify(FIXTURES, null, 2) + "\n", "utf8");

    // (1) 2 件更新(1 件は既に true なので no-op、1 件は新しい id で no match)
    const updates = new Map<string, true>([
      ["nikkyo-2026-04-22-1111111111111111", true],
      ["nikkyo-2026-04-22-3333333333333333", true],
      ["nikkyo-2026-04-22-9999999999999999", true],
    ]);
    const r1 = await applyMembershipUpdates(dir, date, updates);
    assert(r1.changed === 1, `changed should be 1 (only id 1111... flips), got ${r1.changed}`);
    assert(r1.total === 3, `total should be 3, got ${r1.total}`);

    const reloaded = JSON.parse(await readFile(file, "utf8")) as Article[];
    const byId = new Map(reloaded.map((a) => [a.id, a]));
    assert(
      byId.get("nikkyo-2026-04-22-1111111111111111")?.requiresMembership === true,
      "id 1111... should be flipped to true",
    );
    assert(
      byId.get("nikkyo-2026-04-22-2222222222222222")?.requiresMembership === undefined,
      "id 2222... should remain undefined (not in updates)",
    );
    assert(
      byId.get("nikkyo-2026-04-22-3333333333333333")?.requiresMembership === true,
      "id 3333... should remain true (already true, no-op)",
    );
    // 並び順は publishedAt 降順
    assert(
      reloaded[0].id === "nikkyo-2026-04-22-2222222222222222",
      "first article should be the latest publishedAt (18:00)",
    );
    assert(
      reloaded[2].id === "nikkyo-2026-04-22-1111111111111111",
      "last article should be the earliest publishedAt (08:00)",
    );
    // 他フィールドが保持される
    assert(
      byId.get("nikkyo-2026-04-22-1111111111111111")?.summary === "summary 1",
      "other fields (summary) must be preserved",
    );

    // (2) 空 updates Map は no-op
    const r2 = await applyMembershipUpdates(dir, date, new Map());
    assert(r2.changed === 0, "empty updates should be no-op");

    // (3) 全件 already true な状態で再呼び出し → changed=0
    const r3 = await applyMembershipUpdates(
      dir,
      date,
      new Map([["nikkyo-2026-04-22-1111111111111111", true]]),
    );
    assert(r3.changed === 0, "second flip on same id should be no-op");

    // (4) 存在しない date は changed=0 / total=0
    const r4 = await applyMembershipUpdates(
      dir,
      "2099-12-31",
      new Map([["nikkyo-2099-12-31-aaaaaaaaaaaaaaaa", true]]),
    );
    assert(r4.changed === 0 && r4.total === 0, "missing date file should be no-op");

    console.log("[check:membership-updates] 4 scenarios passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
