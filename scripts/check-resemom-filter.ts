/**
 * リセマム NG ワード/PR 表記フィルタの判定検証スクリプト
 *
 * 使い方: `npm run check:filter`(または `npx tsx scripts/check-resemom-filter.ts`)
 *
 * `src/lib/sources/resemom.ts` の `isExcludedByTitle()` に対して、
 * 「除外したい既知パターン」「除外してはいけない既知パターン」の代表サンプルを
 * 入力し、判定が想定通りかを assert する。
 *
 * フィルタを更新したら本スクリプトのケースも追加し、過剰除外 / 漏れの両方を
 * 回帰防止する。
 */
import { isExcludedByTitle } from "../src/lib/sources/resemom.ts";

interface Case {
  title: string;
  expected: boolean;
  reason: string;
}

const CASES: readonly Case[] = [
  // ==== 除外すべき(true) ====
  {
    title: "【中学受験2027】サピックス小学部上位校偏差値",
    expected: true,
    reason: "受験産業色(中学受験 + 偏差値)",
  },
  {
    title: "【高校受験2026】首都圏私立高 倍率速報",
    expected: true,
    reason: "受験産業色(高校受験特集)",
  },
  {
    title: "【大学受験2027】共通テスト科目別ランキング",
    expected: true,
    reason: "受験産業色(大学受験 + ランキング)",
  },
  {
    title: "中学校選び 偏差値だけで決めない 5 つの視点",
    expected: true,
    reason: "偏差値を含むランキング系",
  },
  {
    title: "【GW2026】東京都の子供向けイベント 300 件 Web 公開",
    expected: true,
    reason: "GW 特集タイトル形式",
  },
  {
    title: "【夏休み2026】無料学習教材ランキング",
    expected: true,
    reason: "夏休み特集 + ランキング",
  },
  {
    title: "親子で行きたい 春のおでかけスポット 10 選",
    expected: true,
    reason: "おでかけ系レジャー記事",
  },
  {
    title: "PR 教育系サブスク新サービス開始",
    expected: true,
    reason: "PR 表記",
  },
  {
    title: "話題の英語学習アプリをスポンサード提供",
    expected: true,
    reason: "スポンサード表記",
  },
  {
    title: "[タイアップ] プログラミング教室の体験会",
    expected: true,
    reason: "タイアップ表記",
  },
  {
    title: "【提供】教材メーカー新製品の紹介",
    expected: true,
    reason: "【提供】表記",
  },

  // ==== ADR 0020 narrow パターン(復活 6 件の再混入防止)====
  {
    title: "重田教育財団「海外留学奨学金」5名募集…年2万2千ドル給付",
    expected: true,
    reason: "ADR 0020 narrow / 海外留学+奨学金 + N 名募集",
  },
  {
    title: "朝日新聞「未来をつくる学びテスト」7/12無料…小3対象",
    expected: true,
    reason: "ADR 0020 narrow / 小[1-6]対象 で個別参加募集を捕捉",
  },
  {
    title: "立命館大、地域交流イベント5/17…万博体験など160企画",
    expected: true,
    reason: "ADR 0020 narrow / 地域交流イベント",
  },
  {
    title: "東京経済大、黒田前日銀総裁招き5/13にシンポ…参加無料",
    expected: true,
    reason: "ADR 0020 narrow / シンポ+参加無料 で一般公開イベントを捕捉",
  },

  // ==== ADR 0039 で追加(8 カテゴリ取りこぼし対応)====
  {
    title: "沖縄、早くも梅雨入り…九州～東北は「平年並み」の見通し",
    expected: true,
    reason: "ADR 0039 / 気象(梅雨入り)",
  },
  {
    title: "夏と秋の大型連休は最大9日、GW以降の3連休は計5回",
    expected: true,
    reason: "ADR 0039 / 大型連休カレンダー(GW + 計\\d+回)",
  },
  {
    title: "5月は満月が2回、26年でもっとも遠い満月も…国立天文台",
    expected: true,
    reason: "ADR 0039 / 天文(満月)",
  },
  {
    title: "東大「五月祭」5/16・17…スポーツおすすめ企画3選",
    expected: true,
    reason: "ADR 0039 / 大学広報イベント(五月祭、単独で除外)",
  },
  {
    title: "47万人動員の「芋フェス」甲府駅で初開催5/16・17入場無料",
    expected: true,
    reason: "ADR 0039 / 商業フェス(芋フェス)",
  },
  {
    title: "司法試験＆予備試験2026、会場を発表…日程まとめ",
    expected: true,
    reason: "ADR 0039 / 教員業務外資格(司法試験 + 予備試験)",
  },
  {
    title: "大学・英語学校など担当者が来日「オーストラリア留学フェア」5/23",
    expected: true,
    reason: "ADR 0039 / 留学フェア",
  },
  {
    title: "一人暮らしの学生が「親に感謝」した瞬間は？…Studyplusトレンド研究所調査",
    expected: true,
    reason: "ADR 0039 / Studyplus 系学生意識調査",
  },
  {
    title: "イード・アワード2026「子供英語教材」満足度No.1が決定",
    expected: true,
    reason: "ADR 0039 / 商業ランキング(イード・アワード)",
  },

  // ==== ADR 0051 で追加(NG 拡張、include 方式 hybrid 化に伴う取りこぼし対応)====
  {
    title: "國學院大が7季ぶりV、青学の7連覇阻止…東都大学野球春季リーグ",
    expected: true,
    reason: "ADR 0051 / スポーツ大会試合結果(大学野球リーグ)",
  },
  {
    title: "手づくり遊園地が登場「こどもフェスタ」千葉・市原市…5/31締切",
    expected: true,
    reason: "ADR 0051 / 子ども向け一般イベント(こどもフェスタ)",
  },
  {
    title: "ブルネイでホームステイと交流、小5-高2のジュニア大使募集",
    expected: true,
    reason: "ADR 0051 / 国際交流プログラム参加募集(ジュニア大使)",
  },
  {
    title: "東京六大学野球、勝ち点3明大のスタメン…進学校・強豪校など多彩な出身校",
    expected: true,
    reason:
      "ADR 0051 / 六大学野球関連。「進学校」内の「学校」substring が EDUCATION_PATTERNS を誤通過するため NG 側で先に弾く",
  },
  {
    title: "【高校野球】北海道春季大会、16校の組合せ決定…5/25開幕",
    expected: true,
    reason:
      "ADR 0051 / 高校野球大会(既存 /(?:大学|高校)野球.*(?:リーグ|大会|選手権)/ で捕捉、回帰防止)",
  },

  // ==== ADR 0039 数字統計コピー記事は残す(parser pass、編集者判断) ====
  {
    title: "子供の数は過去最少1,329万人、45年連続で減少…総務省",
    expected: false,
    reason:
      "ADR 0039 / 数字統計の見出しコピーは parser 段階で除外せず、教室規模・統廃合議論で参照される余地を残す",
  },

  // ==== ADR 0023 narrow パターン(取りこぼし 4 件の予防的封じ込め)====
  {
    title: "立命館大「衣笠アートヴィレッジ フェス」5/31、隈研吾氏も登壇",
    expected: true,
    reason: "ADR 0023 narrow / アートヴィレッジ で親子・体験イベントを捕捉",
  },
  {
    title: "JAXA「油井宇宙飛行士ミッション報告会」5/19",
    expected: true,
    reason: "ADR 0023 narrow / (JAXA|宇宙飛行士)+報告会 で一般公開イベントを捕捉",
  },
  {
    title: "スポーツ通訳士の仕事を紹介…元プロ野球選手ら登壇5/24",
    expected: true,
    reason: "ADR 0023 narrow / プロ(野球|...)+選手+登壇 で保護者向けイベントを捕捉",
  },
  {
    title: "GW明けは子供のやる気低下を実感…実際にケアは3割以下",
    expected: true,
    reason: "ADR 0023 narrow / (GW|...)明け+子供 で家庭ライフスタイルを捕捉",
  },

  // ==== 除外してはいけない(false) ====
  {
    title: "山梨県 教員採用奨学金返還補助制度を新設",
    expected: false,
    reason: "教員政策(採用 / 奨学金)— Tier 2 の中核",
  },
  {
    title: "小学校低学年スマホ所有率 初の 3 割超",
    expected: false,
    reason: "統計記事 — 教員 / 保護者双方に価値",
  },
  {
    title: "子供の勉強への AI 利用 55% の親が認める",
    expected: false,
    reason: "ICT × 教育の調査記事",
  },
  {
    title: "新宿区小学校はしか集団発生 18 人感染",
    expected: false,
    reason: "学校衛生ニュース",
  },
  {
    title: "国際天文学オリンピック 2026 日本代表 5 人決定",
    expected: false,
    reason: "STEM ニュース",
  },
  {
    title: "GIGA スクール構想 第 2 期 文科省が方針案",
    expected: false,
    reason: "GIGA は政策キーワード(NG パターンに含めない)",
  },
  {
    title: "学校改革 PRA モデルの導入事例",
    expected: false,
    reason: "PRA は単語の一部 — `\\bPR\\b` 境界で誤判定しないこと",
  },
  {
    title: "高校受験志望校選び 8 割が教育方針重視",
    expected: false,
    reason: "受験テーマだが【高校受験】特集タイトル形式ではない調査記事",
  },
  {
    title: "小学校英語教育のシンポジウム 6/15 横浜",
    expected: false,
    reason: "シンポ単独は教員向け学術系のため弾かない(参加無料の組合せのみ NG)",
  },
  {
    title: "教員採用試験 過去問題集 5冊募集レビュー",
    expected: false,
    reason: "数字+名募集ではないため誤判定しないこと",
  },
  {
    title: "中教審 学校改革ワーキンググループの報告会を 5/18 開催",
    expected: false,
    reason:
      "ADR 0023 で JAXA / 宇宙飛行士 と組み合わせる narrow パターンに統合済(汎用な「報告会」単独は弾かない)",
  },
  {
    title: "学校改革で校長らが登壇、教育シンポ 5/30",
    expected: false,
    reason:
      "プロ野球 / プロサッカー / タレント など特定の登壇者語と組み合わせるのみ。汎用「登壇」は弾かない",
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of CASES) {
  const actual = isExcludedByTitle(c.title);
  if (actual === c.expected) {
    passed++;
  } else {
    failed++;
    failures.push(
      `  expected=${c.expected} actual=${actual}\n` +
        `  title : ${c.title}\n` +
        `  reason: ${c.reason}`,
    );
  }
}

console.log(`[check:filter:resemom] ${passed} passed, ${failed} failed (${CASES.length} cases)`);
if (failed > 0) {
  console.error("\n[check:filter:resemom] FAILURES:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
