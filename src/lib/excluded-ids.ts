/**
 * 削除した記事 ID の永続追跡 denylist(ADR 0020)
 *
 * `src/data/excluded-article-ids.json` に保持する。
 * cron(`scripts/fetch-news.ts`)が dedupe 後・保存前に denylist に該当する ID を
 * 弾くことで、「ADR 0019 で削除した記事が RSS 再配信で main に復活する」事故を
 * 構造的に防ぐ。
 *
 * 仕組み:
 *   - dedupe.ts は「現状の article JSON + 過去 30 日履歴」しか参照しないため、
 *     一度 main から削除した記事の ID は履歴照合の対象外になり、復活する
 *   - 本 denylist は「削除済み」の真実を git 追跡対象として永続化する
 *   - reasons は監査ログ目的(なぜ除外したか)で必須記録
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Article } from "./article-schema.ts";

export const ExcludedArticleId = z
  .string()
  .regex(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/, {
    message: "excluded id must match Article.id format",
  });

export const ExcludedIdsFile = z.object({
  schemaVersion: z.literal(1),
  ids: z.array(ExcludedArticleId),
  reasons: z.record(ExcludedArticleId, z.string().min(1)),
});
export type ExcludedIdsFile = z.infer<typeof ExcludedIdsFile>;

export const DEFAULT_DENYLIST_PATH = path.resolve("src/data/excluded-article-ids.json");

export async function loadExcludedIds(
  filePath: string = DEFAULT_DENYLIST_PATH,
): Promise<ExcludedIdsFile> {
  const buf = await readFile(filePath, "utf8");
  const parsed = ExcludedIdsFile.parse(JSON.parse(buf));
  const idSet = new Set(parsed.ids);
  if (idSet.size !== parsed.ids.length) {
    throw new Error(
      `[excluded-ids] duplicate ids in ${filePath} (${parsed.ids.length} entries, ${idSet.size} unique)`,
    );
  }
  for (const id of parsed.ids) {
    if (!parsed.reasons[id]) {
      throw new Error(`[excluded-ids] missing reason for id ${id}`);
    }
  }
  return parsed;
}

export function filterByDenylist<T extends Pick<Article, "id">>(
  articles: readonly T[],
  excludedIds: ReadonlySet<string>,
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const a of articles) {
    if (excludedIds.has(a.id)) {
      dropped.push(a);
    } else {
      kept.push(a);
    }
  }
  return { kept, dropped };
}
