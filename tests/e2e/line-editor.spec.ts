import { join } from 'node:path'

import { type Locator, type Page, expect, test } from '@playwright/test'

import { type Session, launch, report, withPage } from './take-session.ts'

// Fixing a clip's lines, in the built app: a LibriVox CC0 clip cut into
// lines, one line's end dragged by the mouse and undone, its start dragged
// by touch, its end stepped by the keys, another line split at the
// playhead, all kept across a reload, and the line the split made
// practised with Chromium's fake microphone. Each change tracks again only
// the lines it moved: one curve more on the device for a moved edge, none
// left over once it is undone. Nothing is sent anywhere.

const root = join(import.meta.dirname, '..', '..')
const clip = join(root, 'fixtures', 'real', 'gongitsune.wav')

const lineRows = (page: Page) => page.getByRole('link', { name: /^Line \d+/ })

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

// How many native curves the device keeps.
const nativesKept = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>(resolve => {
        const opening = indexedDB.open('intone')
        opening.onsuccess = () => {
          const database = opening.result
          const counting = database
            .transaction('natives', 'readonly')
            .objectStore('natives')
            .count()
          counting.onsuccess = () => {
            database.close()
            resolve(counting.result)
          }
        }
      }),
  )

const waveform = (page: Page) => page.locator('[data-window-from]')

// Seconds from the clip's start at pixel `x` of the waveform, and back.
const windowOf = async (page: Page) => {
  const frame = waveform(page)
  const box = await frame.boundingBox()
  const from = Number(await frame.getAttribute('data-window-from'))
  const to = Number(await frame.getAttribute('data-window-to'))
  if (box === null) {
    throw new Error('The waveform is not on the page.')
  }
  return {
    box,
    xOf: (seconds: number) =>
      box.x + ((seconds - from) / (to - from)) * box.width,
    secondsPerPixel: (to - from) / box.width,
  }
}

const valueOf = async (slider: Locator): Promise<number> =>
  Number(await slider.getAttribute('aria-valuenow'))

const centreOf = async (locator: Locator) => {
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error('Not on the page.')
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const editorStatus = (page: Page) =>
  page.locator('#line-editor').getByRole('status')

// Waits for the change under way to be kept.
const kept = async (page: Page, notice: RegExp) => {
  await expect(editorStatus(page)).toHaveText(notice, { timeout: 30_000 })
}

test('a CC0 clip’s lines are dragged, stepped, split and undone, kept across a reload, and the new line practised', async ({
  playwright,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000)
  const browser = await launch(playwright, clip)
  try {
    await withPage(
      browser,
      async session => {
        const { page, context } = session
        await page.goto('/upload')
        await page.locator('#upload-file').setInputFiles(clip)
        await page.waitForURL(/\/level\//, { timeout: 120_000 })
        await expect(waveform(page).locator('svg path')).toBeVisible({
          timeout: 30_000,
        })
        const lines = await lineRows(page).count()
        const cutNatives = await nativesKept(page)
        expect(cutNatives).toBe(lines)

        // Line 3's end, dragged 0.3 s earlier by the mouse.
        await page
          .getByRole('button', { name: 'Fix line 3', exact: true })
          .click()
        await expect(
          page.getByText('Line 3 of', { exact: false }),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Stop' }).click()
        const end = page.getByRole('slider', { name: 'End of Line 3' })
        const endBefore = await valueOf(end)
        const { secondsPerPixel } = await windowOf(page)
        const grip = await centreOf(end)
        const pixels = Math.round(0.3 / secondsPerPixel)
        await page.mouse.move(grip.x, grip.y)
        await page.mouse.down()
        await page.mouse.move(grip.x - pixels / 2, grip.y, { steps: 5 })
        await page.mouse.move(grip.x - pixels, grip.y, { steps: 5 })
        await page.mouse.up()
        await kept(page, /^Line 3’s end moved to /)
        const endDragged = await valueOf(end)
        expect(endDragged).toBeCloseTo(endBefore - pixels * secondsPerPixel, 1)
        expect(await nativesKept(page)).toBe(cutNatives + 1)
        await expect(lineRows(page).nth(2)).toContainText(
          `${(endDragged - (await valueOf(page.getByRole('slider', { name: 'Start of Line 3' })))).toFixed(1)} s`,
        )

        // Undone: the edge goes back, and the curve it made with it.
        await page
          .getByRole('button', { name: 'Undo moving line 3’s edge' })
          .click()
        await kept(page, /^The last change is undone\.$/)
        expect(await valueOf(end)).toBe(endBefore)
        expect(await nativesKept(page)).toBe(cutNatives)

        // Its start, dragged 0.2 s later by touch.
        const start = page.getByRole('slider', { name: 'Start of Line 3' })
        const startBefore = await valueOf(start)
        const touch = await context.newCDPSession(page)
        const startGrip = await centreOf(start)
        const touchPixels = Math.round(0.2 / secondsPerPixel)
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: startGrip.x, y: startGrip.y }],
        })
        for (const step of [0.25, 0.5, 0.75, 1]) {
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              { x: startGrip.x + step * touchPixels, y: startGrip.y },
            ],
          })
        }
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        })
        await kept(page, /^Line 3’s start moved to /)
        expect(await valueOf(start)).toBeCloseTo(
          startBefore + touchPixels * secondsPerPixel,
          1,
        )

        // Its end, stepped by the keys: 10 ms three times, then 100 ms,
        // each step said as the slider's time.
        await end.focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Shift+ArrowRight')
        await expect(end).toHaveAttribute(
          'aria-valuenow',
          String(Number((endBefore + 0.13).toFixed(2))),
        )
        await kept(page, /^Line 3’s end moved to /)
        const endStepped = await valueOf(end)

        // Line 1, split at the playhead put in its middle.
        await page
          .getByRole('button', { name: 'Fix line 1', exact: true })
          .click()
        await page.getByRole('button', { name: 'Stop' }).click()
        const first = {
          from: await valueOf(
            page.getByRole('slider', { name: 'Start of Line 1' }),
          ),
          to: await valueOf(
            page.getByRole('slider', { name: 'End of Line 1' }),
          ),
        }
        const middle = (first.from + first.to) / 2
        const { xOf, box } = await windowOf(page)
        await page.mouse.click(xOf(middle), box.y + box.height * 0.25)
        await page.getByRole('button', { name: /^Split at / }).click()
        await kept(page, /^Line 1 is split at .*, into lines 1 and 2\.$/)
        await expect(lineRows(page)).toHaveCount(lines + 1)
        const splitAt = await valueOf(
          page.getByRole('slider', { name: 'End of Line 1' }),
        )
        expect(splitAt).toBeCloseTo(middle, 1)
        await report(testInfo, 'changes', {
          lines,
          endBefore,
          endDragged,
          startBefore,
          endStepped,
          first,
          splitAt,
        })

        // All kept across a reload.
        await page.reload()
        await expect(lineRows(page)).toHaveCount(lines + 1)
        await expect(waveform(page).locator('svg path')).toBeVisible({
          timeout: 30_000,
        })
        await expect(
          page.getByRole('slider', { name: 'End of Line 1' }),
        ).toHaveAttribute('aria-valuenow', String(splitAt))
        await page
          .getByRole('button', { name: 'Fix line 4', exact: true })
          .click()
        await expect(
          page.getByRole('slider', { name: 'End of Line 4' }),
        ).toHaveAttribute('aria-valuenow', String(endStepped))

        // The new line 1, practised: the fake microphone plays the clip
        // from its start, where the line is.
        await lineRows(page).first().click()
        await expect(
          page.getByRole('heading', { name: 'Line 1', level: 1 }),
        ).toBeVisible()
        await page.getByRole('button', { name: 'Record', exact: true }).click()
        await expect(
          page.getByRole('heading', { name: 'Recording' }),
        ).toBeVisible({
          timeout: 30_000,
        })
        await expect(page.getByRole('timer')).toHaveText(/^0:0[3-9]/, {
          timeout: 30_000,
        })
        await page.getByRole('button', { name: 'Stop' }).click()
        await expect(page.getByText(/% match to this clip/)).toBeVisible({
          timeout: 30_000,
        })
        await expect(
          page.getByText('Kept in your history on this device.'),
        ).toBeVisible()
        await report(testInfo, 'score', {
          match: await page.getByText(/% match to this clip/).textContent(),
        })

        // Line 1 changed again: its take is kept, apart from its new
        // trend.
        const linePath = new URL(page.url()).pathname
        await page.goBack()
        await expect(waveform(page).locator('svg path')).toBeVisible({
          timeout: 30_000,
        })
        await page
          .getByRole('button', { name: 'Fix line 1', exact: true })
          .click()
        await page.getByRole('button', { name: 'Stop' }).click()
        const endOfLine1 = page.getByRole('slider', { name: 'End of Line 1' })
        await endOfLine1.focus()
        await page.keyboard.press('Shift+ArrowLeft')
        await kept(page, /^Line 1’s end moved to /)
        await page.goto(linePath.replace(/^\/line\//, '/history/'))
        await expect(
          page.getByRole('heading', {
            name: 'Taken against its earlier start or end',
          }),
        ).toBeVisible({ timeout: 30_000 })
        await expect(
          page.getByText('No takes yet of the line as it is now'),
        ).toBeVisible()

        expectNothingSent(session, baseURL ?? '')
        expect(session.problems).toStrictEqual([])
      },
      { hasTouch: true },
    )
  } finally {
    await browser.close()
  }
})
