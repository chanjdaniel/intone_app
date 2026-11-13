import { statSync } from 'node:fs'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { readModelList, servedModelFiles } from '../../build/models.ts'
import { type Session, withPage } from './take-session.ts'
import { declineTextModel } from './text-offer.ts'

// A line's readings in the built app: offered with the download's size,
// and nothing of the dictionary fetched before the learner turns them on;
// then the kana over the kanji, as ruby, from the dictionary and
// Lindera's WebAssembly, each fetched once from the app's own origin; a
// reading edited and kept across a reload, on the bundled line (kept in
// the settings) and on a line of an uploaded clip (kept with the line);
// the choice kept; and nothing sent anywhere.

const root = join(import.meta.dirname, '..', '..')
const clip = join(root, 'fixtures', 'real', 'gongitsune.wav')

const dictionary = async () => {
  const models = await readModelList(join(root, 'models.json'))
  const model = models.find(each => each.id === 'lindera-ipadic')
  if (model === undefined) {
    throw new Error('models.json lists no lindera-ipadic')
  }
  const wasm = statSync(
    join(root, 'node_modules', 'lindera-wasm', 'lindera_wasm_bg.wasm'),
  ).size
  return {
    path: `/${servedModelFiles([model])[0]?.path}`,
    megabytes: Math.round(
      (model.files.reduce((sum, file) => sum + file.bytes, 0) + wasm) /
        1_000_000,
    ),
  }
}

// The requests for the dictionary or Lindera's WebAssembly, by path.
const readingRequests = (session: Session) =>
  session.requests
    .map(request => new URL(request.url).pathname)
    .filter(path => /lindera/.test(path))

const expectNothingSent = (session: Session, baseURL: string) => {
  const origin = new URL(baseURL).origin
  expect(
    session.requests.filter(
      request =>
        !request.url.startsWith(`${origin}/`) &&
        !request.url.startsWith(`blob:${origin}/`),
    ),
  ).toStrictEqual([])
  expect(
    session.requests.filter(
      request => request.method !== 'GET' || request.body !== null,
    ),
  ).toStrictEqual([])
}

const kanaOver = (page: Page) => page.locator('h1 rt').allTextContents()

const editReading = async (page: Page, word: string, kana: string) => {
  await page.getByRole('button', { name: 'Edit a reading' }).click()
  const field = page.getByLabel(word, { exact: true })
  await expect(field).toBeFocused()
  await field.fill(kana)
  await page.getByRole('button', { name: 'Keep these readings' }).click()
  await expect(
    page.getByRole('button', { name: 'Edit a reading' }),
  ).toBeFocused()
}

test('the bundled line’s readings are offered with their size, shown as ruby, edited and kept across a reload, nothing sent', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const { path, megabytes } = await dictionary()
  await withPage(browser, async session => {
    const { page } = session
    await page.goto('/line/ame-ga-suki/1')
    await expect(
      page.getByText(
        `Shows the kana over the kanji. The first time, it downloads the reading dictionary, ${megabytes} MB, from Intone itself.`,
      ),
    ).toBeVisible()
    await expect(page.locator('h1 ruby')).toHaveCount(0)
    expect(readingRequests(session)).toStrictEqual([])

    await page.getByRole('button', { name: 'Show readings' }).click()
    await expect(page.locator('h1 ruby')).toHaveCount(2)
    expect(await kanaOver(page)).toStrictEqual(['あめ', 'す'])
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute(
      'lang',
      'ja',
    )
    // The dictionary and the tokeniser, once each, from the app's origin.
    const fetched = readingRequests(session)
    expect(fetched.filter(each => each === path)).toHaveLength(1)
    expect(
      fetched.filter(each =>
        /^\/assets\/lindera_wasm_bg-[\w-]{8}\.wasm$/.test(each),
      ),
    ).toHaveLength(1)
    expect(fetched).toHaveLength(2)

    await editReading(page, '雨', 'あま')
    await expect(
      page.getByText('One reading is your own, in colour.'),
    ).toBeVisible()
    expect(await kanaOver(page)).toStrictEqual(['あま', 'す'])

    // After a reload the readings are shown again, the edit with them.
    await page.reload()
    await expect(page.locator('h1 ruby')).toHaveCount(2)
    expect(await kanaOver(page)).toStrictEqual(['あま', 'す'])
    await expect(page.locator('h1 rt').first()).toHaveClass(/text-accent/)

    // Emptied, the dictionary's reading is back.
    await page.getByRole('button', { name: 'Edit a reading' }).click()
    await page.getByLabel('雨', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Keep these readings' }).click()
    await expect.poll(() => kanaOver(page)).toStrictEqual(['あめ', 'す'])

    // Hidden, they stay hidden across a reload, with no size offered.
    await page.getByRole('button', { name: 'Hide readings' }).click()
    await expect(page.locator('h1 ruby')).toHaveCount(0)
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Show readings' }),
    ).toBeVisible()
    await expect(
      page.getByText(/downloads the reading dictionary/),
    ).toHaveCount(0)
    await expect(page.locator('h1 ruby')).toHaveCount(0)

    expect(session.problems).toStrictEqual([])
    expectNothingSent(session, baseURL ?? '')
  })
})

test('a reading edited on a line of an uploaded clip is kept with the line across a reload', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000)
  await withPage(browser, async session => {
    const { page } = session
    await page.goto('/upload')
    await page.locator('#upload-file').setInputFiles(clip)
    await page.waitForURL(/\/level\//, { timeout: 120_000 })
    await declineTextModel(page)
    await page.getByRole('button', { name: 'Add line 1’s text' }).click()
    await page.getByLabel('Line 1’s text', { exact: true }).fill('小狐の穴')
    await page.getByRole('button', { name: 'Keep the text' }).click()
    await page.getByRole('link', { name: /^小狐の穴\s*, Line 1/ }).click()
    await expect(
      page.getByRole('heading', { name: '小狐の穴', level: 1 }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Show readings' }).click()
    await expect
      .poll(() => kanaOver(page))
      .toStrictEqual(['しょう', 'きつね', 'あな'])
    // The dictionary splits 小狐 and reads it wrong; the learner edits
    // both of its words.
    await page.getByRole('button', { name: 'Edit a reading' }).click()
    await page.getByLabel('小', { exact: true }).fill('こ')
    await page.getByLabel('狐', { exact: true }).fill('ぎつね')
    await page.getByRole('button', { name: 'Keep these readings' }).click()
    await expect(
      page.getByText('2 readings are your own, in colour.'),
    ).toBeVisible()

    await page.reload()
    await expect
      .poll(() => kanaOver(page))
      .toStrictEqual(['こ', 'ぎつね', 'あな'])

    expect(session.problems).toStrictEqual([])
    expectNothingSent(session, baseURL ?? '')
  })
})
