// 中教審(chukyo)は文科省(mext)の RSS を中教審の語で絞った派生ソースなので、同じ資料が
// 同じバッチで 2 件になる。id の頭にソース名が入るので dedupeWithin では落ちない(ADR 0077)。
// 落とすのは中教審と同じ URL の文科省記事だけで、同じソースの出し直しには触れない。
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dropMextTwinsOfChukyo } from "../../src/lib/dedupe.ts";
import { mext, rss, resetMextFeedCache } from "../../src/lib/sources/mext.ts";
import { chukyo } from "../../src/lib/sources/chukyo.ts";

const URL_A =
  "https://www.mext.go.jp/b_menu/shingi/chukyo/chukyo3/004/siryo/mext_00016.html";
const URL_B = "https://www.mext.go.jp/a_menu/other.html";

const art = (sourceId, sourceUrl, date = "2026-10-05") => ({
  id: `${sourceId}-${date}-0123456789abcdef`,
  sourceId,
  sourceUrl,
});
const ids = (list) => list.map((a) => a.id);

test("中教審と同じ URL の文科省記事を落とし、中教審側を残す", () => {
  const out = dropMextTwinsOfChukyo([art("mext", URL_A), art("chukyo", URL_A)]);
  assert.deepEqual(ids(out), ["chukyo-2026-10-05-0123456789abcdef"]);
});

test("中教審が無ければ文科省記事は残る", () => {
  const out = dropMextTwinsOfChukyo([art("mext", URL_A), art("nikkyo", URL_A)]);
  assert.deepEqual(ids(out), [
    "mext-2026-10-05-0123456789abcdef",
    "nikkyo-2026-10-05-0123456789abcdef",
  ]);
});

test("URL が違えば、文科省と中教審の両方が残る", () => {
  const out = dropMextTwinsOfChukyo([art("mext", URL_B), art("chukyo", URL_A)]);
  assert.equal(out.length, 2);
});

// ユーザー判断(2026-10-06): 日付を変えた出し直しは内容が変わっていることが多いので、まとめない。
test("同じソースの同じ URL(日付を変えた出し直し)は落とさない", () => {
  const out = dropMextTwinsOfChukyo([
    art("mext", URL_B, "2026-09-25"),
    art("mext", URL_B, "2026-10-05"),
    art("chukyo", URL_A, "2026-09-25"),
    art("chukyo", URL_A, "2026-10-05"),
  ]);
  assert.equal(out.length, 4);
});

// 派生ソースは chukyo だけで、対になるのは mext だけ。他の媒体が同じ資料を報じても別の記事として残す。
test("中教審と同じ URL でも、文科省以外のソースの記事は残る", () => {
  const out = dropMextTwinsOfChukyo([
    art("nikkyo", URL_A),
    art("chukyo", URL_A),
    art("mext", URL_A),
  ]);
  assert.deepEqual(ids(out), [
    "nikkyo-2026-10-05-0123456789abcdef",
    "chukyo-2026-10-05-0123456789abcdef",
  ]);
});

// 文科省の RSS は 1 回の収集で 1 度だけ取り、中教審はその結果を絞る。別々に取ると片方だけが
// タイムアウトする回があり(2026-04-27・2026-09-01)、対になるはずの記事の片方だけがその回に保存される
// (ADR 0077)。
// parseURL を差し替えて、ネットワークに出ずに確かめる。
const FEED = {
  items: [
    {
      title: "中央教育審議会 教育課程部会(第136回)配付資料を掲載しました",
      link: URL_A,
      isoDate: "2026-10-05T07:30:00.000Z",
      contentSnippet: "学校教育",
    },
  ],
};

test("文科省と中教審を同時に取っても、RSS の取得は 1 度だけ", async (t) => {
  resetMextFeedCache();
  const parse = mock.method(rss, "parseURL", async () => FEED);
  t.after(() => {
    parse.mock.restore();
    resetMextFeedCache();
  });
  const [m, c] = await Promise.all([mext.fetch(), chukyo.fetch()]);
  assert.equal(parse.mock.callCount(), 1);
  assert.equal(m.length, 1);
  assert.equal(c.length, 1);
});

test("RSS の取得が失敗すれば、文科省と中教審の両方が失敗する", async (t) => {
  resetMextFeedCache();
  // 1 度目だけ失敗させる。取得を共有していなければ、2 度目(もう片方)は成功してそろわない。
  let calls = 0;
  const parse = mock.method(rss, "parseURL", async () => {
    calls += 1;
    if (calls === 1) throw new Error("Request timed out after 10000ms");
    return FEED;
  });
  t.after(() => {
    parse.mock.restore();
    resetMextFeedCache();
  });
  const [m, c] = await Promise.allSettled([mext.fetch(), chukyo.fetch()]);
  assert.equal(m.status, "rejected");
  assert.equal(c.status, "rejected");
});

// 関数があっても収集の流れから外れれば効かない。fetch-news.ts は import するとネットワークに出るので、
// 呼び出しの形を字面で見る。
test("fetch-news.ts は dedupeWithin の直後に文科省の twin を落とす", () => {
  const src = readFileSync(
    new URL("../fetch-news.ts", import.meta.url),
    "utf8"
  );
  assert.match(src, /dropMextTwinsOfChukyo\(dedupeWithin\(collected\)\)/);
});
