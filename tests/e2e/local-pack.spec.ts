import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { type Session, launch, withPage } from './take-session.ts'

// Daniel's local pack, in the built app: the example pack under
// fixtures/local-pack/ (never local/) imported by its files and by its
// folder, as one level whose lines show their text, kana and source
// links; a line practised with the fake microphone and kept; the pack
// imported again with a changed manifest, the unchanged line keeping its
// take; a selection missing a file refused by name. No request ever goes
// to a source link's host, or anywhere off the app's origin.

const root = join(import.meta.dirname, '..', '..')
const example = join(root, 'fixtures', 'local-pack')
const exampleFiles = [
  'pack.json',
  'audio/hashi.wav',
  'audio/kyou.wav',
  'audio/gongitsune.wav',
].map(file => join(example, file))
const linkHosts = ['youtube.com', 'archive.org']

const expectNothingFetched = (session: Session, baseURL: string) => {
  const origin = new URL(baseURL).origin
  expect(
    session.requests.filter(request =>
      linkHosts.some(host => new URL(request.url).hostname.endsWith(host)),
    ),
  ).toStrictEqual([])
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

const packFilesInput = (page: Page) => page.locator('#pack-files')

const importFiles = async (page: Page, files: ReadonlyArray<string>) => {
  await page.goto('/upload')
  await packFilesInput(page).setInputFiles([...files])
  await page.waitForURL(/\/level\/pack-example/, { timeout: 120_000 })
  await expect(
    page.getByRole('heading', { name: 'Lines to copy' }),
  ).toBeVisible()
}

const lineLinks = (page: Page) =>
  page.getByRole('list').getByRole('link', { name: /^(橋|今日|Line \d)/ })

test('the example pack is imported as one level, its lines practised and imported again, nothing fetched', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(240_000)
  // The take copies 橋を渡ります in the same voice.
  const browser = await launch(playwright, join(example, 'audio', 'hashi.wav'))
  const changed = mkdtempSync(join(tmpdir(), 'local-pack-changed-'))
  try {
    await withPage(browser, async session => {
      const { page } = session
      await page.goto('/upload')
      await expect(
        page.getByRole('heading', { name: 'Import your local pack' }),
      ).toBeVisible()
      await importFiles(page, exampleFiles)

      await expect(
        page.getByRole('heading', { name: 'Example local pack', level: 1 }),
      ).toBeVisible()
      await expect(lineLinks(page)).toHaveCount(4)
      await expect(lineLinks(page).nth(0)).toHaveAccessibleName(
        /^橋を渡ります ?, はしをわたります ?, Line 1 · audio\/hashi\.wav/,
      )
      await expect(lineLinks(page).nth(1)).toHaveAccessibleName(
        /^今日は駅で古い友達に会いました ?, Line 2/,
      )
      // A line with no text is called by its place.
      await expect(lineLinks(page).nth(2)).toHaveAccessibleName(
        /^Line 3 ?, audio\/gongitsune\.wav · 0:00\.6 to 0:03\.6/,
      )
      const youtube = page.getByRole('link', {
        name: 'Source on youtube.com, 0:12.5 to 0:14.1 (opens in a new tab)',
      })
      await expect(youtube).toHaveAttribute(
        'href',
        'https://www.youtube.com/watch?v=intone-local-pack-fixture',
      )
      await expect(youtube).toHaveAttribute('target', '_blank')
      await expect(youtube).toHaveAttribute('rel', 'noopener noreferrer')
      await expect(
        page.getByRole('link', { name: /^Source on archive\.org, 0:30\.4/ }),
      ).toHaveAttribute('rel', 'noopener noreferrer')
      await expect(page.getByRole('button', { name: /^Fix/ })).toHaveCount(0)

      // Kept across a reload, and listed at home as a local pack.
      await page.goto('/')
      await page.reload()
      await page
        .getByRole('link', { name: /^Example local pack\b.*local pack/ })
        .click()
      await expect(lineLinks(page)).toHaveCount(4)

      await lineLinks(page).first().click()
      await expect(
        page.getByRole('heading', { name: '橋を渡ります', level: 1 }),
      ).toBeVisible()
      await expect(
        page.getByText('From your local pack, kept on this device.'),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Record' }).click()
      await expect(
        page.getByRole('heading', { name: 'Recording' }),
      ).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('timer')).toHaveText(/^0:0[2-9]/, {
        timeout: 30_000,
      })
      await page.getByRole('button', { name: 'Stop' }).click()
      await expect(page.getByText(/% match to this clip/)).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        page.getByText('Kept in your history on this device.'),
      ).toBeVisible()

      // The manifest changed: line 1's text fixed, line 4's start moved.
      cpSync(example, changed, { recursive: true })
      const manifest = JSON.parse(
        readFileSync(join(example, 'pack.json'), 'utf8'),
      )
      manifest.lines[0].text = '橋を渡ります。'
      manifest.lines[3].start = 4
      writeFileSync(join(changed, 'pack.json'), JSON.stringify(manifest))
      await importFiles(
        page,
        exampleFiles.map(file => file.replace(example, changed)),
      )
      await expect(lineLinks(page)).toHaveCount(4)
      await expect(lineLinks(page).nth(0)).toHaveAccessibleName(
        /^橋を渡ります。 ?, はしをわたります/,
      )
      await expect(lineLinks(page).nth(3)).toHaveAccessibleName(
        /^Line 4 ?, audio\/gongitsune\.wav · 0:04\.0 to 0:06\.7/,
      )
      await expect(lineLinks(page).nth(0)).toHaveAttribute(
        'href',
        '/line/pack-example/1',
      )

      // Line 1's file and span are unchanged, so its take is still its.
      await page.goto('/history/pack-example/1')
      await expect(page.getByText(/^1 take since /)).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        page.getByText('Taken against its earlier start or end'),
      ).toHaveCount(0)

      expectNothingFetched(session, baseURL ?? '')
      expect(session.problems).toStrictEqual([])
    })
  } finally {
    rmSync(changed, { recursive: true, force: true })
    await browser.close()
  }
})

test('the pack’s folder can be chosen whole', async ({ browser, baseURL }) => {
  test.setTimeout(120_000)
  await withPage(browser, async session => {
    const { page } = session
    await page.goto('/upload')
    await page.locator('#pack-folder').setInputFiles(example)
    await page.waitForURL(/\/level\/pack-example/, { timeout: 120_000 })
    await expect(lineLinks(page)).toHaveCount(4)
    expectNothingFetched(session, baseURL ?? '')
  })
})

test('a selection missing a file the manifest names is refused, naming it, and nothing is kept', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(60_000)
  await withPage(browser, async session => {
    const { page } = session
    await page.goto('/upload')
    await packFilesInput(page).setInputFiles(
      exampleFiles.filter(file => !file.endsWith('kyou.wav')),
    )
    await expect(page.getByRole('alert')).toHaveText(
      'The pack was not imported. pack.json names a file you did not choose: audio/kyou.wav. Choose it too, or the folder that holds the pack.',
    )
    await page.goto('/')
    await expect(
      page.getByRole('link', { name: /Example local pack/ }),
    ).toHaveCount(0)
    expectNothingFetched(session, baseURL ?? '')
  })
})
