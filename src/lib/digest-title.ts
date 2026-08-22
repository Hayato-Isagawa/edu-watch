/**
 * digest の title を「扱う内容の列挙」と「〈年〉年〈月〉月第〈N〉週の論点」に分ける。
 *
 * 書式の正典は docs/digest-workflow.md「執筆上の約束」で、区切りは em dash (U+2014) 1 本。
 * 表示側は 2 つを別行に置く。RSS と `<title>` タグは 1 行のまま使うので、分割は表示専用。
 *
 * 区切りが無い title (書式外) は、そのまま subject として返して week を空にする。
 * 呼び出し側は week が空のときにダッシュを出さない。
 */
const SEPARATOR = " — ";

export function splitDigestTitle(title: string): { subject: string; week: string } {
  const i = title.indexOf(SEPARATOR);
  if (i < 0) return { subject: title, week: "" };
  return {
    subject: title.slice(0, i),
    week: title.slice(i + SEPARATOR.length),
  };
}
