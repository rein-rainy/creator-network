/**
 * Japanese → Hepburn romaji transliteration, backed by the kuromoji
 * morphological analyzer (an optional dependency). Kuromoji yields the
 * katakana reading of each token — including kanji — which we then map to
 * romaji. This is what lets "夜に駆ける" become "Yoru ni Kakeru" rather than
 * a meaning-translation, matching how IMDb indexes Japanese titles.
 *
 * If kuromoji is not installed, `toRomaji` resolves to '' and callers simply
 * skip the romaji query, exactly like the youtubei.js optional dependency.
 */

let tokenizerPromise = null;

function getTokenizer() {
  if (tokenizerPromise) return tokenizerPromise;
  tokenizerPromise = new Promise((resolve) => {
    let kuromoji;
    try {
      kuromoji = require('kuromoji');
    } catch {
      console.warn('[romaji] kuromoji not installed — romaji queries disabled');
      resolve(null);
      return;
    }
    const dicPath = require('path').join(require.resolve('kuromoji'), '..', '..', 'dict');
    kuromoji.builder({ dicPath }).build((err, tokenizer) => {
      if (err) {
        console.warn(`[romaji] kuromoji build failed: ${err.message}`);
        resolve(null);
        return;
      }
      resolve(tokenizer);
    });
  });
  return tokenizerPromise;
}

// Two-kana digraphs (palatalized + small-tsu handled separately).
const DIGRAPHS = {
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo', シャ: 'sha', シュ: 'shu', ショ: 'sho',
  チャ: 'cha', チュ: 'chu', チョ: 'cho', ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo',
  ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo', ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
  リャ: 'rya', リュ: 'ryu', リョ: 'ryo', ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo',
  ジャ: 'ja', ジュ: 'ju', ジョ: 'jo', ビャ: 'bya', ビュ: 'byu', ビョ: 'byo',
  ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
  シェ: 'she', ジェ: 'je', チェ: 'che', ティ: 'ti', ディ: 'di', トゥ: 'tu', ドゥ: 'du',
  ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', ウィ: 'wi', ウェ: 'we', ウォ: 'wo', ヴァ: 'va',
};

const MONOGRAPHS = {
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
  カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so',
  タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
  ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo',
  ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro',
  ワ: 'wa', ヲ: 'o', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
  ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
  バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
  ヴ: 'vu', ー: '', '・': ' ', '　': ' ',
  // Standalone small kana (when not consumed by a digraph above).
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o', ャ: 'ya', ュ: 'yu', ョ: 'yo', ヮ: 'wa',
};

/** Convert a katakana reading string to Hepburn romaji. */
function katakanaToRomaji(kana) {
  let out = '';
  let sokuon = false; // pending small-tsu gemination
  for (let i = 0; i < kana.length; i++) {
    const two = kana.slice(i, i + 2);
    const one = kana[i];

    if (one === 'ッ') { sokuon = true; continue; }

    let romaji;
    if (DIGRAPHS[two]) { romaji = DIGRAPHS[two]; i++; }
    else if (MONOGRAPHS[one]) romaji = MONOGRAPHS[one];
    else romaji = one; // pass through latin / digits / punctuation untouched

    if (sokuon && romaji) { romaji = romaji[0] + romaji; sokuon = false; }
    out += romaji;
  }
  return out;
}

/**
 * Transliterate arbitrary Japanese text to romaji. Returns '' when kuromoji
 * is unavailable or the text contains no Japanese. Romanizes per-token using
 * each token's `reading` (katakana), falling back to the surface form for
 * tokens kuromoji can't read (e.g. latin words), so mixed-script titles like
 * "YOASOBI 夜に駆ける" become "YOASOBI Yoru ni Kakeru".
 */
async function toRomaji(text) {
  if (!text || !/[぀-ヿ一-龯]/.test(text)) return '';
  const tokenizer = await getTokenizer();
  if (!tokenizer) return '';

  const tokens = tokenizer.tokenize(text);
  const parts = tokens.map((token) => {
    const reading = token.reading && token.reading !== '*' ? token.reading : null;
    if (reading) return katakanaToRomaji(reading);
    // No reading: keep latin/number surfaces, drop unreadable symbols.
    return /[぀-ヿ一-龯]/.test(token.surface_form) ? '' : token.surface_form;
  });

  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

module.exports = { toRomaji, katakanaToRomaji };
