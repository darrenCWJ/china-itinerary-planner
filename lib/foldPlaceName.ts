/**
 * Lowercased, trimmed, and stripped of the punctuation and accents nobody types
 * into a search box.
 *
 * Found in the browser: typing "xian" matched the catalog's Xiangyang and missed
 * the curated Xi'an entirely, because the apostrophe broke the substring test.
 * The same gap hid Ürümqi from "urumqi". Romanised place names are full of marks
 * that are optional to the person searching and mandatory in the data — 23 of
 * the 695 catalog cities carry an apostrophe and 2 carry diacritics.
 *
 * Its own module because both search legs need it and only one had it. The fix
 * above landed in `placeSearch` alone, so the client found Tai'an and the server
 * did not; anything going through `/api/destinations` got the broken half. One
 * definition is the only thing that keeps the two legs answering alike.
 */
export function foldPlaceName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      // Strips the combining marks NFD leaves behind: "ü" becomes "u", "é"
      // becomes "e". The range is U+0300–U+036F, written as an escape rather
      // than literally because the characters are invisible in a diff.
      .replace(/[̀-ͯ]/g, "")
      // Straight, curly and modifier-letter apostrophes all read as the same
      // character to someone typing a place name.
      .replace(/['’ʼ`]/g, "")
  );
}
