/**
 * 教育家庭新聞(kkn) NG ワードフィルタの判定検証スクリプト
 *
 * 使い方: `npm run check:filter:kkn`
 *
 * `src/lib/sources/kkn.ts` の `isExcludedByTitle()` に対して、
 * 「除外したい既知パターン」「除外してはいけない既知パターン」
 * 「POSITIVE_OVERRIDE で救うべきパターン」の代表サンプルを入力し、
 * 判定が想定通りかを assert する。ADR 0039 の回帰防止用。
 *
 * フィルタを更新したら本スクリプトのケースも追加し、過剰除外 / 漏れの両方を
 * 回帰防止する。
 */
import { isExcludedByTitle } from "../src/lib/sources/kkn.ts";

interface Case {
  title: string;
  expected: boolean;
  reason: string;
}

const CASES: readonly Case[] = [
  // ==== 除外すべき(true) ====
  // コンテスト/アワード系
  {
    title: "高校生の発想と表現の祭典「全国高校文化祭入場門アワード2026」作品応募受付中〜uni 三菱鉛筆表現革新振興財団",
    expected: true,
    reason: "ADR 0039 / アワード + 応募受付 + 財団(三重マッチ)",
  },
  {
    title: "U20が生物学の知識と技術を競う「日本生物学オリンピック2026」参加申込み受付中　〜6/15まで",
    expected: true,
    reason: "ADR 0039 / オリンピック + 参加申込",
  },
  {
    title: "＜第25回聞き書き甲子園＞全国12地域で実施　5/8より参加高校生募集開始。オンライン説明会を5/19に開催",
    expected: true,
    reason: "ADR 0039 / 甲子園 + 説明会",
  },
  // 講座/出前授業系
  {
    title: "小学生向け体験型ワークショップ「D-SciTech プログラム～未来のエンジニアのために～」 2026年度上半期7講座を開催〜東京電機大学",
    expected: true,
    reason: "ADR 0039 / ワークショップ",
  },
  {
    title: "京大、高大連携事業 学びコーディネーターの出前授業　希望校募集6/11から",
    expected: true,
    reason: "ADR 0039 / 出前授業 + 希望校募集",
  },
  {
    title: "国立天文台、出張授業「ふれあい天文学」2026年度の実施校を募集中",
    expected: true,
    reason: "ADR 0039 / 出張授業 + 実施校募集",
  },
  {
    title: "明大、高校生向けプレゼンコンテストのキックオフ講座「やさしい日本語入門」を5/16にオンラインで開催",
    expected: true,
    reason: "ADR 0039 / コンテスト + キックオフ講座",
  },
  {
    title: "芝浦工業大、夏の公開講座を7月〜9月に実施　子供向けSTEAMプログラムなど10講座を開講",
    expected: true,
    reason: "ADR 0039 / 公開講座",
  },
  // イベント告知系
  {
    title: "ロイロ、「NEXT GIGAサミット2026」を5/13-15に東京・有明で開催　OS選定・学校DX・働き方改革の事例を共有",
    expected: true,
    reason: "ADR 0039 / サミット(GIGA でも商業イベント告知は除外)",
  },
  {
    title: "AI時代の子供を守る「法教育×メディアリテラシー」シンポジウムを5/2に東京で開催〜こども六法スクール",
    expected: true,
    reason: "ADR 0039 / シンポジウム",
  },
  {
    title: "自治体フォーラム2026「学びの多様化と子どもの居場所のこれから〜学校と放課後でつくる実践事例」5/27オンライン開催〜放課後NPOアフタースクール",
    expected: true,
    reason: "ADR 0039 / フォーラム",
  },
  {
    title: "「共学か、女子大か」で迷う高校生へ。総合型選抜で女子大に進学した先輩が語るオンラインイベントを5/16に開催〜ルークス志塾",
    expected: true,
    reason: "ADR 0039 / オンラインイベント + 塾(複数マッチ)",
  },
  // 募集系
  {
    title: "世界に挑戦する10代を募集！「Global Innovator ACADEMY」2026年度エントリー受付中〜教育の環",
    expected: true,
    reason: "ADR 0039 / エントリー受付",
  },
  // 商業告知系
  {
    title: "テクノホライゾン、4Kシンプル書画カメラ「L-12S」発売　有線接続のエントリーモデル",
    expected: true,
    reason: "ADR 0039 / 発売",
  },
  {
    title: "マウスコンピューター、メーカー整備・保証付きリユースPC「マウス整備済パソコン」を販売",
    expected: true,
    reason: "ADR 0039 / 販売開始(を販売 = 販売を?開始 のマッチ)",
  },
  // 塾/財団/協会主催
  {
    title: "ちゅうでん教育振興財団、学校教育活動への助成支援および教育実践論文を募集中",
    expected: true,
    reason: "ADR 0039 / 財団 + 募集",
  },
  // 食品・医薬品など業務外
  {
    title: "冷凍食品を上手に使って自分のお弁当を作ろう～中高生がチャレンジ！",
    expected: true,
    reason: "ADR 0039 / 冷凍食品 + お弁当",
  },
  {
    title: "てんかん重積状態への早急な対応のために～「スピジア点鼻液®」を使用する学校関係者向けのウェブサイトを開設",
    expected: true,
    reason: "ADR 0039 / 点鼻液 + スピジア(医薬品プロモーション)",
  },

  // ==== POSITIVE_OVERRIDE で救うべき(false、教員向けセミナー類) ====
  {
    title: "教職員向けセミナー「Google for Education 事例校×生成AIパイロット校の挑戦」5/23に開催〜ミカサ商事",
    expected: false,
    reason: "ADR 0039 POSITIVE_OVERRIDE / 教職員向け で救う(セミナー NG を上書き)",
  },
  {
    title: "教員向け校務 DX セミナー「働き方改革と AI 活用」5/20 開催(仮想ケース)",
    expected: false,
    reason: "ADR 0039 POSITIVE_OVERRIDE / 教員向け で救う(セミナー + 開催 NG を上書き)",
  },

  // ==== 厳格 override の境界(true、複合表記は意図的にブロック) ====
  {
    title: "生徒が「防災」を自分ごとにする探究の授業デザイン――中高教員・教委向けセミナーを開催〜カシオ×八千代エンジニヤリング",
    expected: true,
    reason:
      "ADR 0039 / セミナー で除外、「中高教員・教委向け」は POSITIVE_OVERRIDE 厳格(教員向け/教職員向け/学校教員)に該当しないため block",
  },
  {
    title: "生成AIは“生涯にわたる教育”をどう変えるのか――教育・福祉関係者向けオンライン勉強会を5/10に開催〜教育AI活用協会",
    expected: true,
    reason:
      "ADR 0039 / オンラインイベント・勉強会・協会主催の三重マッチ。「教育・福祉関係者向け」は厳格 override に該当せず block",
  },

  // ==== 除外してはいけない(false、教員業務 / 政策 / ICT 採用継続) ====
  {
    title: "校務に特化した生成ＡIサービスを利用～教材作成などで校務の効率化を図る～沖縄県",
    expected: false,
    reason: "教員業務(校務 AI、Tier 2 の中核採用)",
  },
  {
    title: "福島市教委、安全な校務環境の構築に向けデバイス証明書管理サービスを導入",
    expected: false,
    reason: "教委政策(校務環境、教員業務インフラ)",
  },
  {
    title: "文部科学省「学校教育におけるAI活用に関するこれまでの取組」を公表",
    expected: false,
    reason: "文科省政策発表(教員視点の中核)",
  },
  {
    title: "小中学校に2人以上のICT支援員を配置～ICT機器の授業活用などを支援～沖縄県西原町",
    expected: false,
    reason: "ICT 支援員配置政策(教員業務支援)",
  },
  {
    title: "熊本県菊池市、今年度よりAIドリルを導入　市内の小中学校15校約3500人が「すららドリル」を利用開始",
    expected: false,
    reason: "自治体 AI 教材導入(教員視点の事例)",
  },
  {
    title: "コニカミノルタ、都立学校向け生成AIサービス「都立AI」の2026年度 改修・保守・運用等業務を受託",
    expected: false,
    reason: "都立 AI 業務受託(教育委員会政策の周辺情報)",
  },
  {
    title: "ミマモルメの学校向け「欠席・遅刻等受付機能」と、私学向け校務支援システム「スクールマスターZeus」が連携開始",
    expected: false,
    reason: "校務支援システム連携(NG パターンに該当しない教員業務情報)",
  },
  {
    title: "最短3分で週案を作成　時数計算できる無料アプリ「さくっと週案」提供開始〜明治図書出版",
    expected: false,
    reason:
      "週案アプリ提供開始(「販売を?開始」ではなく「提供開始」のため NG パターンに該当しない、教員業務支援)",
  },
  {
    title: "MIRAIE、高校生の探究学習を支援する生成AIプラットフォーム「FUTURE COMPASS」を開発、全国のモデル校で実証授業を開始",
    expected: false,
    reason: "AI プラットフォーム開発・実証(NG パターンに該当しない、教員視点の事例)",
  },
  {
    title: "包括的性教育推進に向けて連携協定～宮崎モデルを構築して全国へ発信～宮崎市",
    expected: false,
    reason: "自治体連携協定(NG パターンに該当しない政策ニュース)",
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

console.log(`[check:filter:kkn] ${passed} passed, ${failed} failed (${CASES.length} cases)`);
if (failed > 0) {
  console.error("\n[check:filter:kkn] FAILURES:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
