# 0006. vite major アップデートを Dependabot で ignore

- 状態: 採用
- 日付: 2026-04-25
- 関連 PR: #8(close), #9(merge)

## 背景

Dependabot が `vite 7 → 8` の major アップデート PR(#8)を上げたが、CI ビルドで以下のエラーが発生した:

```
Missing field 'tsconfigPaths' on BindingViteResolvePluginConfig.resolveOptions
```

原因は `@tailwindcss/vite 4.2.2` が vite 8 にまだ対応していないこと。`@tailwindcss/vite` の `resolveOptions` が `tsconfigPaths` フィールドを返しておらず、vite 8 のバインディング検証で落ちる。

ローカルで `@tailwindcss/vite` の最新版を試したが同症状。vite 8 対応の `@tailwindcss/vite` がリリースされるまで、major アップデートは受け入れられない状態だった。

## 検討した選択肢

- **A) vite 7 にピンし、Dependabot で vite major アップデートを ignore**
- **B) `@tailwindcss/vite` を別の Tailwind 統合方式(`postcss` 経由など)に切り替えて vite 8 に上がる**
- **C) 毎回 Dependabot PR を手動でクローズし、`@tailwindcss/vite` 対応を待つ**

## 決定

**A)** を採用。

- PR #8 をクローズ
- `.github/dependabot.yml` に vite major アップデートの ignore ルールを追加(PR #9 で実装、マージ済)
- `package.json` で `vite` を `^7.3.2` にピン
- `@tailwindcss/vite` が vite 8 対応版をリリースした時点で ignore 削除して再度 major アップデートを受け入れる

### 既存の ignore ルールとの整合

すでに **TypeScript major アップデート** も ignore 済み(`@astrojs/check` の peer dependency と衝突するため)。同じ理由(直接依存ではなく上流ライブラリの対応待ち)で扱いを揃える。

## 帰結

### 良い帰結

- ビルドが安定し続ける
- Dependabot ノイズが減り、対応が必要な PR(セキュリティ / 真の major)に集中できる
- 同種の「上流対応待ち」ピンが 2 件揃ったため、運用パターンとして定着

### トレードオフ

- vite 8 のパフォーマンス改善 / セキュリティ修正の恩恵を受けられない期間が発生
- `@tailwindcss/vite` の対応リリースを能動的に追う必要がある
- vite 7 に CVE が出た場合の対応は別途必要(その場合は ignore 緩和を検討)

## 撤回 / 再検討の条件

- `@tailwindcss/vite` が vite 8 対応版をリリースした時点
- vite 7 に深刻な CVE が出た場合
- Tailwind の統合方式を `postcss` ベースに切り替える判断が出た場合
