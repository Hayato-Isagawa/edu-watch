# 0079. bot の収集と push を別 job に分け、PAT を依存のコードから隔てる

- 状態: 採用(0042「workflow 改修」と 0049 のうち、PAT を checkout に渡して persist したまま、同じ job で収集を実行する部分を上書き)
- 日付: 2026-10-21
- 関連 PR: `ci/split-pat-push-jobs`(本 ADR 起票)
- 関連 ADR: [`ADR 0042`](0042-fetch-news-token-elevation.md)(fetch-news の PAT) / [`ADR 0049`](0049-recheck-nikkyo-token-elevation.md)(recheck の PAT)

## 背景

`fetch-news.yml` と `recheck-nikkyo-membership.yml` は、`AUTO_COLLECT_PAT` を `actions/checkout` に渡して persist したまま、同じ job で `npm ci` と `npx tsx scripts/...` を実行していた。persist された資格情報は job が終わるまで残り、後続の step から読める(checkout v6 以降は `.git/config` ではなく `$RUNNER_TEMP` のファイルに置かれるが、同じ job の中では変わらない)。依存のどれかが侵害されると、そのコードが PAT を読める。PAT は `Contents` / `Pull requests` / `Workflows` の書き込みを持つ(ADR 0042「前提条件」)。

同じ job の中で「push の step だけにトークンを渡す」形にしても足りない。先に動いたコードが `.git/hooks` や `$GITHUB_PATH` / `$GITHUB_ENV` に仕掛けを残せば、それはトークンを持った push の step の中で実行される。

## 決定

2 本とも、収集と publish を別 job に分ける。

- 収集の job(`fetch` / `recheck`): 権限は `contents: read` だけ。checkout には PAT を渡さず、`persist-credentials: false` で資格情報を残さない(checkout の既定で `contents: read` の GITHUB_TOKEN は入力として渡るが、persist はされない)。依存を入れて収集し、`src/data/articles/` に変更があれば artifact に上げて、`changed` を outputs で返す
- publish の job: `changed` が `true` のときだけ動く。PAT で checkout し、artifact を `src/data/articles/` に上書きで展開して、commit・push・PR 作成・auto-merge の有効化を行う。npm も依存も入れない。write の権限はこの job にだけ置く
- PAT を checkout に渡すこと自体(0042 の目的: bot PR で required check を起動させる)は変えない。変わるのは、PAT が依存のコードと同じ job に載らなくなったこと

## 影響と運用

- 収集のスクリプトは、ファイルを足すか書き換えるだけで消さない。この前提に乗っている。upload-artifact は既定で隠しファイル(`.gitkeep`)を含めず、publish は上書きで展開するので、ファイルを消す変更は publish に届かない。消す処理を足すときは、この渡し方を見直す
- 2 つの job は同じ run の同じコミットを checkout する。上書きの展開が、その間に main へ入った変更を巻き戻すことはない
- 侵害された依存が収集の結果(記事の JSON)を改ざんすることは、分割の後も防げない。PR の required check に任せる点は分割の前と同じ
- artifact の保持は 1 日
- 新着の無い回の fetch-news は PAT を使わないので、PAT が失効していても緑で終わる。失効の検知は毎回 PAT で API を呼ぶ `pat-expiry-check.yml` に任せる。同 workflow が立てる Issue の「影響」と「復旧手順」の動作確認も、これに合わせて直した

## 検証

マージ前に、本番の経路(PAT での push と PR 作成)は走らせられない。マージ後、publish が実際に動いた回(fetch-news は新着があった回、recheck は更新があった回。recheck もほとんどの週で PR を作るが、作らない週もある)で、push・PR 作成・PR 側の required check の起動・auto-merge の有効化を確かめる。publish が skip された回は検証に数えない。PAT が通るかだけを確かめるなら、毎回 PAT で API を呼ぶ `pat-expiry-check` を使う。
