# 0061. W-1 推論ホストで Flash Attention を有効化(gemma3:12b の CPU 退避解消)

- 状態: 採用
- 日付: 2026-06-27
- 関連 ADR: 0040(gemma3:12b 採用・W-1 パイプライン)/ 0050(W-1 MVP)/ 0046(retry 入力 raw 化)
- 関連 PR: TBD(本 ADR 起票 PR)
- 撤回 / 再検討トリガー: 本 ADR §「撤回 / 再検討の条件」参照

## 背景

W-1 AI 要約(ADR 0040 / 0050)はローカル Ollama(M1 MacBook Air 16GB / `gemma3:12b` Q4_K_M)で実行する。運用中、生成速度が回ごとに不安定で、特に複数 section 連続実行の末尾で劇的に劣化する事象を観測していた(`observation-2026-06-07.md` §9.2: betsutenpu-3 の reduce が 0.93 t/s = 通常 4.9-5.9 t/s の約 1/6、原因「メモリプレッシャー疑い・未特定」)。

2026-06-27 に実機 A/B ベンチで原因を切り分けた結果、**Ollama の既定 `OLLAMA_FLASH_ATTENTION=false` が主因**と判明した。

### 計測(M1 16GB / gemma3:12b / 実 honbun チャンク / num_ctx=32768)

| 構成 | FA | KV | SIZE | PROCESSOR | prefill t/s | decode t/s | 合計秒 |
|---|---|---|---|---|---|---|---|
| 旧 prod(既定) | off | f16 | **12 GB** | **28% CPU / 72% GPU** | 51.7 | **2.40** | 145.9 |
| FA のみ ON | on | f16 | **8.1 GB** | **100% GPU** | 66.9 | **6.64** | 90.5 |
| FA + q8_0 + ctx20480 | on | q8_0 | 7.8 GB | 100% GPU | 57.6 | 5.39 | 106.5 |
| 高ctx 65536 | on | f16 | 9.1 GB | 24% CPU / 76% GPU | 44.5 | 2.74 | 153.8 |
| 高ctx 65536 | on | q8_0 | 7.9 GB | 100% GPU | 48.2 | 4.96 | 124.7 |

- 使用可能 VRAM は 11.8 GiB(16GB機・macOS が約 4GB 予約)。**FA-OFF 時は非フラッシュのアテンション計算バッファが約 3.9GB 肥大**(KVキャッシュは両者 480 MiB で同一)し、合計 12GB が天井を超えて 28% を CPU に退避 → decode 2.4 t/s に転落していた。
- **FA を ON にするだけで 8.1GB に収まり 100% GPU・decode 6.64 t/s(約 2.8 倍)・合計時間 -38%**。Flash Attention は数値的に厳密なアルゴリズムであり、要約品質への影響はない。
- 旧 prod が回ごとに不安定だったのは、構成が VRAM 天井ギリギリに張り付き、同時起動アプリの空きメモリ次第で退避率が変動していたため。FA-ON は footprint を天井下に決定的に下げ、速度を安定化する。

## 検討した選択肢

### A. 現状維持(FA off)(却下)

`observation-2026-06-07.md` §9.2 の末尾速度劣化を放置。無人 cron 運用での速度非決定性が残り、ADR 0050 の安定運用方針に反する。

### B. Flash Attention を有効化し、KV は f16・num_ctx=32768 を据え置く(採用)

FA-ON のみで CPU 退避が解消し 100% GPU・2.8 倍。KV は f16 のまま(下記 C 参照)、num_ctx も据え置く(下記 D 参照)。変更は推論ホストの環境変数 1 個のみで、リポジトリのコード変更ゼロ。

### C. KV キャッシュを q8_0 で常用(却下)

KV を q8_0 にすると 480→255 MiB に半減するが、**GPU に収まる場面では脱量子化オーバーヘッドでむしろ遅い**(計測: f16 6.64 vs q8_0 5.39 t/s)。q8_0 が有効なのは高 ctx(65536: q8_0 が 100%GPU を維持、f16 は CPU 退避)や gemma4 の thinking 運用などメモリが律速になる場面に限られる。prod 32K では f16 を維持し、q8_0 は将来オプションとする。

### D. num_ctx を大幅削減のみ(FA は off のまま)(却下)

実需は約 15.4K(honbun prompt 12.8K + 生成 2.6K)で 32768 は過剰だが、FA-OFF のままでは計算バッファ肥大が残り根治しない。num_ctx 削減は FA-ON 後の副次的な余裕確保策(任意)に留める。

### E. gemma4 へ移行(別 ADR)

FA-ON は gemma4 採用(`observation-2026-06-07.md` §10.4 選択肢A)を阻んでいた最大の速度懸念を解消し得るが、モデル変更は ADR 0040 の再検討事項であり本 ADR の scope 外。

## 決定

W-1 推論ホスト(ローカル Ollama daemon)で **`OLLAMA_FLASH_ATTENTION=1` を必須**とする。KV キャッシュは f16、`num_ctx=32768` を据え置く(`scripts/ai-summary/*.mjs` の既定不変)。モデルは `gemma3:12b` Q4_K_M を維持(ADR 0040)。

## 結果 / 影響

- **永続化**: `~/Library/LaunchAgents/com.hayato.ollama-flashattention.plist`(RunAtLoad で `launchctl setenv OLLAMA_FLASH_ATTENTION 1` + 旧 env の serve を pkill→supervisor が FA=1 で respawn)。Ollama.app にはネイティブ設定 UI / config.json が無いため LaunchAgent が唯一の永続手段。
- **検証**: num_ctx=32768 でモデルロード後 `ollama ps` が `100% GPU` なら正常。`NN% CPU` が出たら env 未適用の退行 → Ollama.app を終了→再起動。
- **コード変更なし**: パイプラインは推論ホストの daemon 設定に依存するのみ。`scripts/ai-summary/` は不変。
- **品質**: FA は厳密アルゴリズムのため strict 基準(ADR 0054)への影響なし。
- **gemma4 への含意**: 速度懸念が緩和されるため、§E の再評価余地が広がる(別 ADR)。

## 撤回 / 再検討の条件

- Ollama 側で Flash Attention が既定 ON 化された場合(env 明示が不要になり LaunchAgent 撤去可)
- gemma4 採用(ADR 0040 再検討)に伴い num_ctx / KV 量子化の最適点が変わった場合
- 推論ホストを 16GB 機から変更し VRAM 天井制約が外れた場合
- `ollama ps` で CPU 退避が再発した場合(env 適用失敗 or 同時起動アプリのメモリ圧)
