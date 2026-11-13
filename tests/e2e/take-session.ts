import {
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
  expect,
} from '@playwright/test'

// What every take's end-to-end test shares: a page that records its
// requests, console problems and microphone tracks, Chromium with the fake
// microphone, and attached measurements.

export type Session = Readonly<{
  context: BrowserContext
  page: Page
  // Every request the page and its Workers made.
  requests: Array<
    Readonly<{ url: string; method: string; body: string | null }>
  >
  problems: Array<string>
}>

// A page at 1280 px and two device pixels to each CSS pixel, which
// records every request, console problem and microphone track; with
// `hasTouch`, it can be tapped.
export const withPage = async <A>(
  browser: Browser,
  use: (session: Session) => Promise<A>,
  options: Readonly<{ hasTouch?: boolean }> = {},
): Promise<A> => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: options.hasTouch ?? false,
  })
  const page = await context.newPage()
  const session: Session = { context, page, requests: [], problems: [] }
  context.on('request', request => {
    session.requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    })
  })
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      session.problems.push(message.text())
    }
  })
  page.on('pageerror', error => session.problems.push(error.message))
  // Keeps every track the app is given, so the test can see it stopped.
  await page.addInitScript(() => {
    const tracks: Array<MediaStreamTrack> = []
    Object.assign(window, { intoneTracks: tracks })
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    )
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints)
      tracks.push(...stream.getTracks())
      return stream
    }
    document.addEventListener('securitypolicyviolation', event => {
      console.error(
        `CSP violation: ${event.violatedDirective} ${event.blockedURI}`,
      )
    })
  })
  try {
    return await use(session)
  } finally {
    await context.close()
  }
}

export const trackStates = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate(() => {
    const tracks: unknown = Reflect.get(window, 'intoneTracks')
    return Array.isArray(tracks)
      ? tracks.flatMap(track =>
          track instanceof MediaStreamTrack ? [track.readyState] : [],
        )
      : []
  })

export const report = (testInfo: TestInfo, name: string, body: unknown) =>
  testInfo.attach(name, {
    body: JSON.stringify(body, null, 2),
    contentType: 'application/json',
  })

// Chromium with its fake microphone playing `wav` once, from when the
// microphone opens.
export const launch = (
  playwright: { chromium: { launch: (options: object) => Promise<Browser> } },
  wav: string,
  allowMicrophone = true,
) =>
  playwright.chromium.launch({
    // The headless shell cannot show a permission prompt at all, so it
    // answers getUserMedia "not supported"; full Chromium, headless, has
    // the prompt, which the deny flag answers no.
    ...(allowMicrophone ? {} : { channel: 'chromium' }),
    args: [
      '--use-fake-device-for-media-stream',
      // Answers the permission prompt: yes, or, as a learner can, no.
      allowMicrophone
        ? '--use-fake-ui-for-media-stream'
        : '--deny-permission-prompts',
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
    ],
  })

// The bundled line's practice screen, where every take is recorded.
export const linePath = '/line/ame-ga-suki/1'

// Opens the line and waits for its native curve, tracked on first open.
export const openLine = async (page: Page): Promise<void> => {
  await page.goto(linePath)
  await expect(
    page.getByRole('heading', { name: 'Copy the line' }),
  ).toBeVisible({ timeout: 30_000 })
}
