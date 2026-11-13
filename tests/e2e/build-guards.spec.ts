import { expect, test } from '@playwright/test'

import {
  onnxRuntimeDirectory,
  onnxRuntimeFiles,
  onnxRuntimeVersion,
} from '../../build/onnx-runtime.ts'
import { withPage } from './take-session'

// The production build in Chromium: the policy holds and nothing breaks
// it, the dev library is absent, and ONNX Runtime's WebAssembly is served
// from the app's own origin. tests/e2e/model-serving.spec.ts and
// tests/build/serving.test.ts read the model files.

test('the home screen loads under the Content Security Policy with no violation or request elsewhere', async ({
  browser,
  baseURL,
}) => {
  await withPage(browser, async ({ page, problems, requests }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Intone' }),
    ).toBeVisible()

    expect(problems).toStrictEqual([])
    expect(
      requests
        .map(request => request.url)
        .filter(url => !url.startsWith(`${baseURL}/`)),
    ).toStrictEqual([])
    await expect(
      page.locator('meta[http-equiv="Content-Security-Policy"]'),
    ).toHaveAttribute(
      'content',
      /^default-src 'self'; script-src 'self' 'wasm-unsafe-eval';/,
    )
  })
})

test('a production build has no component library at /dev', async ({
  page,
}) => {
  await page.goto('/dev')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Nothing here' }),
  ).toBeVisible()

  await page.goto('/dev/tokens')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Nothing here' }),
  ).toBeVisible()
  await expect(page.getByText('Choices for you')).toHaveCount(0)
})

test("ONNX Runtime's WebAssembly is served from the app's own origin", async ({
  request,
}) => {
  const directory = onnxRuntimeDirectory(await onnxRuntimeVersion())
  for (const file of onnxRuntimeFiles) {
    const response = await request.get(`/${directory}${file}`)
    expect(response.status(), file).toBe(200)
  }
  const wasm = await request.get(`/${directory}${onnxRuntimeFiles[0]}`)
  expect(wasm.headers()['content-type']).toBe('application/wasm')
})
