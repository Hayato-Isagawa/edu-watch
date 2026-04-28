/**
 * 媒体メタデータ
 *
 * 各 sourceId に対応する表示名・URL・バッジ用のアクセント色をまとめる。
 * 7 媒体を一目で識別できるよう色を別ける。中心色は edu-watch のアクセント
 * (#1e4a6e)を起点とした隣接トーンで、派手すぎず判別性を保つ。
 */
import type { SourceLayer } from "./article-schema.ts";

export interface SourceMeta {
  sourceId: string;
  displayName: string;
  shortName: string;
  homeUrl: string;
  badgeColor: string;
  layer: SourceLayer;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  mext: {
    sourceId: "mext",
    displayName: "文部科学省",
    shortName: "文科省",
    homeUrl: "https://www.mext.go.jp/",
    badgeColor: "#7a3b3b",
    layer: 1,
  },
  chukyo: {
    sourceId: "chukyo",
    displayName: "中央教育審議会",
    shortName: "中教審",
    homeUrl: "https://www.mext.go.jp/b_menu/shingi/chukyo/index.html",
    badgeColor: "#8e3a3a",
    layer: 1,
  },
  nier: {
    sourceId: "nier",
    displayName: "国立教育政策研究所",
    shortName: "国研",
    homeUrl: "https://www.nier.go.jp/",
    badgeColor: "#2b5d3a",
    layer: 1,
  },
  resemom: {
    sourceId: "resemom",
    displayName: "リセマム",
    shortName: "リセマム",
    homeUrl: "https://resemom.jp/",
    badgeColor: "#b56b3f",
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
    layer: 2,
  },
};

export function getSourceMeta(sourceId: string): SourceMeta | undefined {
  return SOURCE_META[sourceId];
}
