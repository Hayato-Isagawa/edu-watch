# Brand Guide — 木の部位体系

EduEvidence JP / EduWatch JP / 将来のツールサイト(教員業務支援)/ 将来の法律サイト(教員を守る法知識)を、**「1 本の木」の部位** に対応付けるブランド体系。4 サイト(以上)が 1 つの生態系として統合され、教員の実務構造と視覚的に重なる。

本ガイドは edu-evidence / edu-watch 両リポジトリに同一の内容で配置する(将来 `@edu-evidence/brand` のような shared パッケージ化を検討)。

---

## 1. 基本コンセプト

教員の仕事を **1 本の木** に見立てる。足元に法があり、幹で業務を支え、葉で学びを育て、双葉で日々新しい情報を吸収する。

| 部位 | 対応サイト | 意味 | 状態 |
|---|---|---|---|
| **根(root)** | 将来: 法律サイト(教員を守る) | 足元から支える基盤、目に見えない制度知識 | 未実装 |
| **幹(trunk / stem)** | 将来: ツールサイト(業務支援 SaaS) | 日常業務の中核を通す支柱 | 未実装 |
| **成熟した葉(mature leaf)** | **EduEvidence JP**(edu-evidence.org) | 光を受けて学びを育てる(エビデンスの蓄積) | 実装済み |
| **双葉(cotyledon)** | **EduWatch JP**(news.edu-evidence.org) | 日々の新しい芽吹き(日次ニュース) | 実装済み |

### 将来の拡張余地

- **実(fruit)**: 実際の成果・ロールモデル事例
- **花(flower)**: 表彰・成果発表
- **種(seed)**: 次世代教員養成・採用支援

木のどの部位にも新しいサイトを足せる構造。

---

## 2. 色トークン

各サイトでアクセント色だけが異なり、ベースは共通。

| サイト | `--color-accent` | 選定根拠 |
|---|---|---|
| EduEvidence JP | `#2b5d3a`(深緑) | 葉・光合成・学術・自然 |
| EduWatch JP | `#1e4a6e`(ディープネイビー) | 新聞紙面の伝統色・信頼・時事 |
| ツール(将来) | `#8b6f47` 周辺(アンバー / 濃茶)予定 | 幹・木質・実用・道具 |
| 法律(将来) | `#6b4423` 周辺(茶)予定 | 根・土・基盤・守護 |

### 共通のベーストークン(全サイト同一)

- `--color-bg: #faf9f5`(ウォームオフホワイト)
- `--color-ink: #1a1a1a`(ほぼ黒)
- `--color-sub: #6b6b66`(サブテキスト)
- `--color-line: #e5e3da`(線)
- `--color-card: #ffffff`(白)
- `--color-chart-red: #c0392b`(チャート対比色)

ベースを共通にすることで、サイト間の移動時にタイポグラフィ・余白・チャートの雰囲気が揃い、姉妹ブランドであることが視覚的に伝わる。

---

## 3. ロゴ実装規約

### ファイル構成

```
src/components/Logo.astro   — inline SVG、currentColor 継承
public/logo.svg             — 外部共有用(OG/RSS)、アクセント色を固定色で埋め込み
public/favicon.svg          — favicon 用、タイル背景 + 白抜きモチーフ
```

### inline SVG の規約

- `fill="currentColor"` を使用。色は呼び出し側の `color:` / `text-` クラスで制御
- 葉脈・白抜き要素は `stroke="var(--color-bg)"` を使用(背景色と同色で「くり抜き」を演出)
- 茎・補助線は `stroke="currentColor"` で主色に連動
- `aria-hidden="true"` を付ける(装飾目的、wordmark 側で意味を伝える)

### Layout での使い方

```astro
---
import Logo from "../components/Logo.astro";
---
<a href="/" class="flex items-center gap-2 whitespace-nowrap">
  <span class="text-[var(--color-accent)] inline-flex shrink-0">
    <Logo class="w-8 h-8" />
  </span>
  EduEvidence <span class="text-[var(--color-accent)]">JP</span>
</a>
```

マーク自体のみアクセント色、wordmark 本体はベース色、末尾の `JP` のみアクセント色。これで wordmark のリズム(重・軽・重)が保たれ、サイト間でも同じ発音パターンが並ぶ。

### サイズの標準

| 配置 | ヘッダー | フッター |
|---|---|---|
| EduEvidence JP(葉) | `w-7 h-7` | `w-5 h-5` |
| EduWatch JP(双葉) | `w-8 h-8` | `w-6 h-6` |

双葉の方がモチーフの面積が小さいため、表示サイズを一段大きくして均衡を取る。新サイトも**モチーフの視覚的重さに応じてサイズを調整** する(規則というより均衡感を優先)。

---

## 4. 対称性の方針

サイトの性格に応じて、ロゴの左右対称/非対称を使い分ける。

| サイト性格 | ロゴ構図 | 対応サイト |
|---|---|---|
| **安定 / 信頼 / 積み重ね** | 左右対称 | EduEvidence JP(葉)、法律(根)、ツール(幹) |
| **動き / 速度 / 新鮮さ** | 左右非対称 | EduWatch JP(双葉) |

法律・ツールは現行の未実装サイト側で新規デザインする際、**左右対称** を基本とする(制度・業務の安定感を表現)。
EduWatch JP 以降で「流動的なサイト」を作る場合は、同様に非対称を検討する。

---

## 5. wordmark 規約

全サイト共通:

- サイト名は **スペースなしの 1 単語**(`EduEvidence` / `EduWatch`)
- 末尾に半角スペース + 2 文字の国コード(`JP`)
- 末尾 `JP` のみアクセント色、その他はベースインク色

例: `EduEvidence <accent>JP</accent>` / `EduWatch <accent>JP</accent>`

将来のサイト名も同パターンで命名する(仮): `EduTools JP` / `EduLaw JP` 等。

---

## 6. チェックリスト(新サイト立ち上げ時)

新サイトのロゴとブランド確定時に以下を確認:

- [ ] 木のどの部位を担当するかが決まっている
- [ ] アクセント色が他 3 サイトと明度帯で近く、色相で区別される
- [ ] モチーフが favicon サイズ(16-32px)でも判読できる
- [ ] 左右対称 / 非対称の方針がサイト性格と整合する
- [ ] ロゴは `src/components/Logo.astro` に inline SVG + `currentColor` で実装
- [ ] `public/logo.svg` と `public/favicon.svg` に固定色版を配置
- [ ] wordmark が `Edu*** <accent>JP</accent>` パターン
- [ ] ベーストークン(bg / ink / sub / line / card)は姉妹サイトと同一
- [ ] CLAUDE.md に「ブランド」節を追加し、本ガイドへのリンクを記載

---

## 7. 参考

- 本ガイドと同一内容を EduWatch JP リポジトリ(`Hayato-Isagawa/edu-watch`)の `docs/BRAND.md` にも配置する
- 将来サイトが 4 つを超えた段階で、共有 npm パッケージ化(`@edu-evidence/brand`)を検討
