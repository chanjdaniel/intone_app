// A reading in kana split into its morae, the beats pitch accent counts
// in: each kana is one, a small ya, yu, yo, a small vowel or a small wa
// joins the kana before it (きょ, ファ), and the moraic nasal (ん), the
// geminate's small tsu (っ) and a long vowel, whether written with a
// vowel (う in がっこう) or a bar (ー), are each a mora of their own.
// The starter set states each line's morae and accent type by this
// count (docs/starter-set.md), where an accent type of n means the fall
// comes after the nth mora.

// Kana that join the one before them, in hiragana and katakana.
const joining = new Set('ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ')

// What a reading may hold between its words, and is left out.
const between = new Set(' 　、。・,.')

const isKana = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x3041 && code <= 0x3096) ||
    (code >= 0x30a1 && code <= 0x30fa) ||
    code === 0x30fc
  )
}

export const moraeOf = (reading: string): ReadonlyArray<string> => {
  const morae: Array<string> = []
  for (const char of reading) {
    if (between.has(char)) continue
    if (!isKana(char)) {
      throw new Error(`“${char}” in “${reading}” is not kana`)
    }
    if (joining.has(char)) {
      const before = morae.pop()
      if (before === undefined || before === 'っ' || before === 'ッ') {
        throw new Error(
          `“${char}” in “${reading}” has no kana before it to join`,
        )
      }
      morae.push(before + char)
    } else {
      morae.push(char)
    }
  }
  return morae
}

export const moraCount = (reading: string): number => moraeOf(reading).length
