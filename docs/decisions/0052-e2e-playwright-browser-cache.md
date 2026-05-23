# 0052. e2e workflow に Playwright ブラウザキャッシュを導入

- 状態: 採用
- 日付: 2026-05-23
- 関連 ADR: 0009(fetch-news PR フロー)/ 0050(W-1 AI summary、workflow 設計改善)
- 関連 PR: TBD(本 ADR の実装)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

2026-05-23 セッション #87(PR #186 マージ時)で E2E job の `Install Playwright browsers` step が約 12 分滞留した。空 commit `2cb248f` を push して新 run を起こすこと(`concurrency: cancel-in-progress` で旧 run キャンセル)で回避したが、根本対策ではない。

E2E job は GitHub-hosted runner で `npx playwright install chromium --with-deps` を毎 run 実行しており、毎回 chromium binary(約 200MB)+ OS パッケージ(libgbm0 / libxkbcommon0 等)を fresh ダウンロード + `apt-get install` していた。Playwright 公式は CI で `~/.cache/ms-playwright` を `actions/cache` でキャッシュすることを推奨している(`playwright.dev/docs/ci#caching-browsers`)。

本リポでは既に `link-check.yml` で `actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae`(v5)を採用しており、同 SHA を流用できる。

## 検討した選択肢

### A. 現状維持(却下)

- 毎 run で binary + OS deps を fresh インストール
- 却下理由: 12 分滞留が再発する都度、空 commit retrigger という運用ハックが必要。再発確率は Playwright/ubuntu-latest 双方のアップストリーム事情に依存するため予測不能

### B. Playwright バージョン文字列を cache key にする(採用)

- `node -p "require('@playwright/test/package.json').version"` で取得したバージョン文字列を cache key に含める
- cache hit 時: binary は cache から復元、OS deps だけ `npx playwright install-deps chromium` で再導入
- cache miss 時: 現状通り `npx playwright install chromium --with-deps`

### C. `hashFiles('**/package-lock.json')` を cache key にする(却下)

- 却下理由: Playwright 以外の依存変更(他 npm パッケージのバージョン更新)で lockfile hash が変わると、Playwright バージョンが同じでも cache miss する。Dependabot の頻度を考えると無駄な cache miss が増える

### D. cache hit 時も `--with-deps` を実行(却下)

- 却下理由: `--with-deps` は binary install + OS deps の両方を実行する。cache hit 時に binary 再 install を走らせると cache のメリットが薄れる。`install-deps` 単独呼出しが意図的

## 決定

B を採用。`.github/workflows/e2e.yml` に以下を追加する。

### (1) Playwright バージョン取得 step

```yaml
- name: Get Playwright version
  id: playwright-version
  run: echo "version=$(node -p "require('@playwright/test/package.json').version")" >> $GITHUB_OUTPUT
```

### (2) actions/cache step

```yaml
- name: Cache Playwright browsers
  id: playwright-cache
  uses: actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae # v5
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}
```

### (3) Install step の二分岐

```yaml
- name: Install Playwright browsers (cache miss)
  if: steps.playwright-cache.outputs.cache-hit != 'true'
  run: npx playwright install chromium --with-deps

- name: Install Playwright system deps (cache hit)
  if: steps.playwright-cache.outputs.cache-hit == 'true'
  run: npx playwright install-deps chromium
```

## 結果

### Pros

- 通常 PR で chromium binary(~200MB)ダウンロードを skip、E2E job 時間が大幅短縮
- セッション #87 の 12 分滞留と空 commit retrigger 運用ハックが不要に
- Playwright 公式推奨パターンへの準拠
- 帯域コスト削減(GitHub-hosted runner からの外部ダウンロードトラフィック削減)

### Cons

- Playwright バージョン更新時(`@playwright/test` を bump する Dependabot PR)は cache miss、その 1 run だけ従来並みの所要時間(これは設計上の意図、cache の正当性を保つため)
- repo の Actions cache 領域(GitHub 10GB/repo 制限)を ~200MB 消費

### 副次効果

- `actions/cache@27d5ce7...` を 2 ファイル目(link-check.yml に続く)で利用するため、将来 SHA 更新時の作業範囲が増える(SHA pin 統一が完了している前提で許容)
- cache hit 経路と cache miss 経路で異なる install コマンドを実行するため、PR テスト時はどちらの経路を通ったかを runner ログで確認する習慣が必要

## 撤回 / 再検討の条件

以下のいずれかが観測された場合、本決定を再検討する:

1. cache hit 経由で E2E が flaky になった(binary バージョンと test 期待値の乖離など)
2. Actions cache 領域が repo 上限(10GB)に達し他 cache を圧迫した
3. Playwright が公式 cache 推奨パターンを変更した(`~/.cache/ms-playwright` 以外の path、key 構造の更新など)
4. cache 機構のキー衝突 / 復元失敗で別問題が顕在化した
5. ubuntu-latest 側で OS deps インストールに新たな遅延要因が出現した(`install-deps` 単独でも数分かかるようになった等)

## 関連リソース

- Playwright 公式 CI guide: `playwright.dev/docs/ci#caching-browsers`
- 既存パターン参照: `.github/workflows/link-check.yml` line 39-45(lychee cache)
- ADR 0009: fetch-news PR フロー(GitHub Actions 設計)
- ADR 0050: W-1 AI summary MVP(workflow 設計改善の先行事例)
- セッション #87 active.md ブロック: 12 分滞留と空 commit retrigger の経緯
