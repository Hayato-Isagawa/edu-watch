/**
 * 媒体メタデータ
 *
 * 各 sourceId に対応する表示名・URL・バッジ用のアクセント色をまとめる。
 * 7 媒体を一目で識別できるよう色を別ける。中心色は edu-watch のアクセント
 * (#1e4a6e)を起点とした隣接トーンで、派手すぎず判別性を保つ。
 */
import type { SourceLayer } from "./article-schema.ts";

/**
 * 媒体の三層 Tier(ADR 0003)。
 * Tier 1/2 は自動収集対象(`SourceLayer`)、Tier 3 は参考のみで Article schema には保存しない。
 */
export type SourceTier = SourceLayer | 3;

/**
 * Tier 1 媒体のサブ分類(ADR 0036)。
 * - `primary`: 一次研究・一次政策文書を主目的とする媒体(mext / chukyo / nier)
 * - `official-opinion`: 公式機関の局長級以上が責任を負って発信するオピニオン(oecd)
 *
 * 当面 UI には露出させず、週次ダイジェスト編集時の参照優先度付けと
 * 将来の Tier 1 拡充判断の材料として保持する。Tier 1 以外の媒体では未指定。
 */
export type Tier1Kind = "primary" | "official-opinion";

export interface SourceMeta {
  sourceId: string;
  displayName: string;
  shortName: string;
  homeUrl: string;
  badgeColor: string;
  layer: SourceTier;
  tier1Kind?: Tier1Kind;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  mext: {
    sourceId: "mext",
    displayName: "文部科学省",
    shortName: "文科省",
    homeUrl: "https://www.mext.go.jp/",
    badgeColor: "#7a3b3b",
    layer: 1,
    tier1Kind: "primary",
  },
  chukyo: {
    sourceId: "chukyo",
    displayName: "中央教育審議会",
    shortName: "中教審",
    homeUrl: "https://www.mext.go.jp/b_menu/shingi/chukyo/index.html",
    badgeColor: "#8e3a3a",
    layer: 1,
    tier1Kind: "primary",
  },
  nier: {
    sourceId: "nier",
    displayName: "国立教育政策研究所",
    shortName: "国研",
    homeUrl: "https://www.nier.go.jp/",
    badgeColor: "#2b5d3a",
    layer: 1,
    tier1Kind: "primary",
  },
  oecd: {
    sourceId: "oecd",
    displayName: "OECD Education and Skills Today",
    shortName: "OECD",
    homeUrl: "https://oecdedutoday.com/",
    badgeColor: "#3a5a7a",
    layer: 1,
    tier1Kind: "official-opinion",
  },
  resemom: {
    sourceId: "resemom",
    displayName: "リセマム",
    shortName: "リセマム",
    homeUrl: "https://resemom.jp/",
    badgeColor: "#8a4f2a",
    layer: 2,
  },
  nikkyo: {
    sourceId: "nikkyo",
    displayName: "日本教育新聞",
    shortName: "日教",
    homeUrl: "https://www.kyoiku-press.com/",
    badgeColor: "#6b2c4f",
    layer: 2,
  },
  kkn: {
    sourceId: "kkn",
    displayName: "教育家庭新聞",
    shortName: "教家新",
    homeUrl: "https://www.kknews.co.jp/",
    badgeColor: "#534e7a",
    layer: 2,
  },
  kyodo: {
    sourceId: "kyodo",
    displayName: "共同通信",
    shortName: "共同",
    homeUrl: "https://www.kyodo.co.jp/",
    badgeColor: "#3a4a5e",
    layer: 3,
  },
};

export function getSourceMeta(sourceId: string): SourceMeta | undefined {
  return SOURCE_META[sourceId];
}
