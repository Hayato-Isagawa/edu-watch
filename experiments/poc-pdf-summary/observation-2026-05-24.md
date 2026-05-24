# observation-2026-05-24: strict 判定の自動化 + observation-2026-05-19 §3.2 §4.2 訂正

## 1. 目的

W-1 強化 A「LLM 事前知識補完検出機構」の実装(`scripts/ai-summary/fact-check-grep.mjs` の `judgeStrict` + report.json `strict` セクション)とその検証結果。

加えて、本実装の過程で observation-2026-05-19 §3.2 の strict 84.6%(22/26)および §4.2 の LLM 補完疑い 3 件が pre-existing バグ由来の誤計測値だったことが判明したため、その訂正報告も含む。

## 2. 計測条件

- 環境/モデル/対象 PDF は observation-2026-05-19 と同じ
  - PDF: 文部科学省「教師の処遇改善等に関する令和7年度予算要求の概要等について」(`tsuuchi-r6-08-27`)
  - 3 sections: honbun(本文)/ betsutenpu-2 / betsutenpu-3
  - LLM: Ollama gemma3:12b ctx128K
- 検証コマンド:
  ```
  node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27 \
    --skip-extract --skip-mapreduce --skip-retry
  ```
- `--skip-retry` のため retry 出力は session 93 で生成された既存 `summary-checked-raw.chunk*.md` を流用(strict 判定の summary 側 input に取り込まれる)
- 実行時間: 0.2s(LLM 呼び出しなし、grep のみ)
- 修正内容 2 件:
  - **バグ #1 修正**(セッション 94): `squeezeJpSpaces` 関数(V3 仕様)。漢字 / ひらがな / カタカナ / ASCII 数字 / カンマ間の `\s+` を反復削除。`judgeStrict` 内 raw chunk text 正規化のみに適用
  - **バグ #2 修正**(セッション 95、本 PR): `loadRawChunkSources` の page index 同視バグ。`split(pageMarker)` で得た array index と PDF 通しページ番号を同視していたため、extracted ファイルが PDF の一部 page のみを含むケース(betsutenpu-2/3)で `slice(86, 87)` のような範囲外 slice が空 array を返していた。修正は page marker `--- page N / Total ---` を `matchAll` で抽出し、page 番号 → 本文の `Map<number, string>` を構築 → `pageMap.get(p)` で lookup する方式

## 3. 計測結果

### 3.1 strict 判定結果(本 PR 適用後、26/26 = 100%)

| section | initial | strict | llm_hallucination | llm_dropped | missing |
|---|---|---|---|---|---|
| honbun | 1/8 | **8/8** | 0 | 0 | 0 |
| betsutenpu-2 | 9/9 | **9/9** | 0 | 0 | 0 |
| betsutenpu-3 | 4/9 | **9/9** | 0 | 0 | 0 |
| 合計 | 14/26 | **26/26 = 100%** | 0 | 0 | 0 |

### 3.2 observation-2026-05-19 §3.2 計測値の訂正

| section | 2026-05-19 §3.2 strict | 本計測 strict | 差分原因 |
|---|---|---|---|
| honbun | 7/8 | 8/8 | バグ #1 修正(squeezeJpSpaces で漢字間スペース吸収) |
| betsutenpu-2 | 9/9 | 9/9 | (当時は strict 判定が pipeline 未実装で、observation 著者の手動 grep は別ロジック) |
| betsutenpu-3 | 6/9 | 9/9 | バグ #2 修正(rawChunk 空 array で 3 件を hallucination と誤判定) |
| 合計 | 22/26 = 84.6% | 26/26 = 100% | — |

observation-2026-05-19 §3.2 当時は strict 判定が pipeline 内に未実装で、observation 著者が手元で chunk 1 raw text に対して柔軟スペース対応 grep を回した結果として 22/26 = 84.6% を報告していた。本 PR で実装した自動化 strict 判定は同じ raw chunk lookup を試みるが、`loadRawChunkSources` の page index 同視バグ(本 PR で発見・修正)で extracted ファイル全体が空 array として渡り、betsutenpu-2/3 のすべての fact が hallucination 候補となっていた。

つまり observation §3.2 の手動 grep ロジックと、自動化 strict の loadRawChunkSources ロジックは別実装で、後者にバグがあったために観測結果が乖離していた。両ロジックを揃えた(バグ修正した)本計測値が真値。

### 3.3 observation-2026-05-19 §4.2 LLM 補完疑い 3 件の訂正

§4.2 では betsutenpu-3 で以下 3 件が「LLM 事前知識補完疑い」とされていた:

- `salary-adjustment-4to13`(教職調整額 4%→13%)
- `class-teacher-allowance-3000`(学級担任への加算 月額3,000円)
- `principal-allowance-5to10k`(管理職手当の改善 月額5,000~10,000円)

本 PR で修正した `loadRawChunkSources` で正しく抽出した PDF page 88-90(extracted-betsutenpu-3.txt)に対して grep した結果、3 件すべて本文中に実在することを確認:

| fact | 確認位置(extracted-betsutenpu-3.txt 行番号) |
|---|---|
| salary-adjustment-4to13 | L145(「教職調整額の改善」)/ L152-153(「教職調整額の水準を 4％から」) |
| class-teacher-allowance-3000 | L168-169(「学級担任への加算:月額」「3,000」) |
| principal-allowance-5to10k | L171(「管理職手当の改善」)/ L173(「5,000」)/ L407(「:10,000」) |

PDF 抽出時の改行で数値と単位が断片化(例: 「月額」と「3,000」が別行)しているため、当該 facts は LLM が pre-training 知識から補完していたわけではなく、PDF 本文に実在していた。observation-2026-05-19 §4.2 の「LLM 事前知識補完疑い」3 件は、pre-existing バグ #2 由来の誤検出と確定。

## 4. バグ修正経緯

### 4.1 バグ #1: PDF 抽出時の漢字間スペース(セッション 94 で修正)

PDF 抽出が日本語文字の間に半角スペース U+0020 や改行を大量に挿入していた。例: 「月 45 時 間」「過 労 死」「イン\nターバル」「令和 6 年 9 月3 0 日」。

required-facts pattern は `(月|1か月)\s*45\s*時間` のように ASCII 数字側 `\s*` だけ用意していたため、漢字「時 間」のスペースを吸収できず honbun strict 0/8(squeeze 適用前)。

修正案 V3(2026-05-24 user 承認):

```
function squeezeJpSpaces(s) {
  return s.replace(/([぀-ヿ㐀-鿿0-9,])\s+(?=[぀-ヿ㐀-鿿0-9,])/g, '$1');
}
```

漢字 U+3400-9FFF + ひらがな/カタカナ U+3040-30FF + ASCII 数字 + カンマ間の `\s+` を反復削除。英字を含めない(英単語間 space を保持)。`judgeStrict` 内 raw chunk text 正規化のみに適用。

適用後: honbun strict 1/8 → **8/8** ✓(observation §3.2 期待値 7-8/8 完全再現)。

V2 (`[ \t]+` のみ) では 7/8、V3 (`\s+` で改行も吸収) で 8/8 となり V3 採用。page marker は 10 個保持(squeeze 後も marker パターンは破壊されない)。

### 4.2 バグ #2: loadRawChunkSources の page index 同視(セッション 95、本 PR で修正)

**症状**: betsutenpu-2/3 で strict が `0/9`(llm_hallucination 9)継続。バグ #1 修正後も改善せず。

**原因**: `loadRawChunkSources` 内

```
const rawPages = extracted.split(pageMarker).map((p) => p.trim()).filter((p) => p.length > 0);
const slice = rawPages.slice(r.startPage - 1, r.endPage);
```

`rawPages` の array index は extracted ファイル内の 0-based 連番だが、`r.startPage` / `r.endPage` は PDF の通しページ番号(例: betsutenpu-2 では 87)。

betsutenpu-2 の場合:

- extracted-betsutenpu-2.txt は PDF page 87 1 ページのみを含む
- `rawPages.length === 1`、`rawPages[0]` = page 87 本文
- chunkRanges: `[{ startPage: 87, endPage: 87 }]`
- `rawPages.slice(86, 87)` → 空 array
- 結果: chunk 1 の raw text が空文字列、全 9 facts が rawChunkHit=false で llm_hallucination 判定

**修正**: page marker `--- page (\d+) / \d+ ---` を `matchAll` で抽出し、actual page number をキーとする `Map<number, string>` を構築。`pageMap.get(p)` で lookup。

```
const pageMarkerRe = /--- page (\d+) \/ \d+ ---/g;
const matches = [...extracted.matchAll(pageMarkerRe)];
const pageMap = new Map();
for (let i = 0; i < matches.length; i++) {
  const pageNum = Number(matches[i][1]);
  const start = matches[i].index + matches[i][0].length;
  const end = i + 1 < matches.length ? matches[i + 1].index : extracted.length;
  pageMap.set(pageNum, extracted.slice(start, end).trim());
}
// for each chunk range:
for (let p = r.startPage; p <= r.endPage; p++) {
  const content = pageMap.get(p);
  if (content !== undefined) parts.push(`--- page ${p} / ${pageMap.size} ---\n${content}`);
}
```

honbun(startPage=1)も互換動作(pageMap.get(1)...pageMap.get(N) で全 page 取得、元の `slice(0, N)` と同じ結果)。

**適用後**:

- betsutenpu-2: strict 0/9 → **9/9** ✓
- betsutenpu-3: strict 0/9 → **9/9** ✓(observation §4.2 hallucination 3 件は誤検出と判明)

## 5. 結論

- W-1 強化 A の strict 判定機構(`judgeStrict` + `strict` セクション)は構造的に機能している
- observation-2026-05-19 §3.2 strict 84.6%(22/26)は pre-existing バグ由来の誤計測値であり、真値は 100%(26/26)
- 同 §4.2 LLM 補完疑い 3 件はバグ #2 由来の誤検出
- strict 判定機構の実装過程で pre-existing バグ #1 #2 を発見・修正できたことは、強化 A の副次的成果として記録に値する

なお §3.3(出典対応)/ §4.3(ADR 0040 §C-2 chunk size)/ §4.4(stillMissing 1 件分析)は本訂正の対象外。strict 数値の絶対値は更新されるが、それ以外の出典対応や ADR 議論は無効化しない。

## 6. 関連

- ADR 0054: 本 PR の決定記録(strict 判定 + page-marker lookup fix)
- ADR 0050 §監視「LLM 事前知識補完」: 本機構の実装契機
- observation-2026-05-19 §3.2 §4.2: 本 observation で訂正対象
- 本 observation §7: セッション 96 / n=1 retry path 副次効果評価

## 7. 追加観測(セッション 96 / n=1 retry path 副次効果)

セッション 95 で残置された Open question(retry path の rawChunk text 正常化による副次効果)を 1 回試行で検証。

### 7.1 計測条件

- コマンド: `node scripts/ai-summary/run-pipeline.mjs --slug tsuuchi-r6-08-27 --skip-extract --skip-mapreduce`(`--skip-retry` を解除、extract/mapreduce はキャッシュ流用)
- 試行回数: n=1
- LLM: gemma3:12b (Ollama, http://localhost:11434)
- 比較対象: pre = セッション 95 時点の `summary-checked-raw.chunk1.md`(`--skip-retry` 流用前提で strict 26/26 達成)

### 7.2 計測結果

| section | pre strict | post strict |
|---|---|---|
| honbun | 8/8 | **6/8**(llm_dropped 2) |
| betsutenpu-2 | 9/9 | 9/9 |
| betsutenpu-3 | 9/9 | 9/9 |
| **合計** | 26/26 (100%) | **24/26 (92.3%)** |

honbun で `notice-number-date`(通知 文科初第1293号 令和6年9月30日付け)/ `interval-11h`(勤務間インターバル 11時間目安)の 2 件が llm_dropped 判定(rawChunkHit=true、summaryHit=false)。post の retry chunk output に fact 名は章立てメタ(`通知の概要 → p.1` / `勤務間インターバル → p.7`)として登場するが本文要約に値の文字列が含まれない構造。

retry chunk size: pre 3018 → post 2909 bytes(-3.6%、ほぼ同等)。LLM 呼び出し時間: honbun 368s / betsutenpu-3 339s(合計 707s ≒ 12 分)。

### 7.3 仮説

- **A. LLM stochastic 変動**: gemma3:12b の非決定論的出力。同じ prompt でも結果が変動する可能性。n=1 では結論不可
- **B. prompt 入力構造変化**: `buildRetryPrompt(summary, recoverable, single)` の `single` 引数(per-chunk rawChunk text)が、バグ #2 修正による `loadRawChunkSources` の `pageMap.get(N)` 方式変更で内容変化した可能性。`buildRetryPrompt` 自体はセッション 95 で変更なし

### 7.4 含意

ADR 0054 が主張する strict 26/26 = 100% は「過去 retry chunk 流用」前提のスナップショット値であり、新規 retry でロバストに再現される保証はない。セッション 96 ではバックアップを書き戻して pre 状態(strict 26/26)に復元、post chunk(strict 24/26)は廃棄。

### 7.5 次の検証案(セッション 97 以降)

1. **n=2,3 反復実行**(仮説 A 判定、各 ~700s + Ollama コスト)
2. **`buildRetryPrompt` 入力の pre/post diff**(仮説 B 判定、LLM 呼ばず完結)
3. **判定結果に応じた ADR 0054 補足**(stochastic なら strict 許容変動幅を明記、体系的なら buildRetryPrompt 入力経路修正検討)

### 7.6 仮説 B 検証結果(セッション 97)

検証スクリプト `/tmp/verify-hypothesis-b.mjs`(本セッション内のみ、未 commit)で `loadRawChunkSources` の pre(PR #177 / commit `6acd761`)と post(PR #195 / commit `8eecfd8`)両実装を同一の `extracted-honbun.txt` に対して呼び、`single = { 1: allChunkSources[1] }` の中身を比較。

| 項目 | pre | post | 一致 |
|---|---|---|---|
| pageCount(rawPages.length / pageMap.size) | 10 | 10 | ✓ |
| chunk1 bytes | 40794 | 40794 | ✓ |
| chunk1 lines | 404 | 404 | ✓ |
| 内容(`===`) | true | | ✓ |

honbun は 1 chunk(`startPage=1, endPage=10`)で、`extracted-honbun.txt` には空ページが存在せず `rawPages.length === pageMap.size === 10`。observation §4 の「honbun は互換動作」がバイト単位で厳密に成立することを確認した。

→ **仮説 B(prompt 入力構造変化)は否定**。`buildRetryPrompt(summary, recoverable, single)` への入力は pre/post で完全一致のため、retry prompt 自体も完全一致する(`buildRetryPrompt` 本体は PR #195 で変更なし)。

### 7.7 仮説 A(LLM stochastic)の構造的根拠

`scripts/ai-summary/fact-check-grep.mjs:211` の `callOllama` 設定:

```js
options: { temperature: 0.2, num_ctx: NUM_CTX }
```

- **temperature: 0.2**(非ゼロ、stochastic)
- **seed 指定なし**(Ollama API 呼び出しごとに異なる random seed)
- `gemma3:12b` 現在 ID `f4031aab637d`、`ollama list` 上 12 days ago(≒ 2026-05-12)修正済、セッション 95 → 96 → 97 間で model 差なし

同じ prompt + 同じ context_window でも、出力は実行ごとに確率的に変動する構造。これが honbun retry の strict 8/8 → 6/8 回帰(`notice-number-date` / `interval-11h` 脱落)の直接的説明。

### 7.8 含意とフォロー

- ADR 0054 の strict 26/26 = 100% は「retry path を 1 回実行した時の単一スナップショット」値
- 再実行による変動幅は n=1 で 24/26(92.3%)を観測、真の許容変動幅は未確定
- 許容変動幅の確定には n=2,3 反復測定が必要(各 ~707s + Ollama コスト ≒ 35-40 分相当)
- ADR 0054 補足の方向性候補:
  - (a)ADR 0054 末尾に「補足(2026-05-24)」セクションを追加し、strict 26/26 がスナップショット値であること・temperature 0.2 / seed なしによる stochastic 変動を許容することを明記
  - (b)新規 ADR 0055 として「W-1 強化 A: strict 値の単一スナップショット性と stochastic 変動許容」を起票
  - (c)n=2,3 計測完了まで補足を保留し、許容変動幅数値が出てから一括で記録
- 検証スクリプト `/tmp/verify-hypothesis-b.mjs` の扱い:
  - (i)`experiments/poc-pdf-summary/verify-hypothesis-b.mjs` として commit し再現可能にする
  - (ii)observation §7.6 の表とスクリプト全体を本ノート内に追記して、本体は破棄
  - (iii)現状の `/tmp/` 配置のまま、本セッション終了で消える
