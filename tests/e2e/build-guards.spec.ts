import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { modelPath, readModelList } from '../../build/models.ts'
import {
  onnxRuntimeDirectory,
  onnxRuntimeFiles,
  onnxRuntimeVersion,
} from '../../build/onnx-runtime.ts'

// The production build in Chromium: the policy holds and nothing breaks
// it, the dev library is absent, and the model and WebAssembly files are
// served from the app's own origin.

const root = join(import.meta.dirname, '..', '..')

test('the home screen loads under the Content Security Policy with no violation or request elsewhere', async ({
  page,
  baseURL,
}) => {
  const problems: Array<string> = []
  const elsewhere: Array<string> = []
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(message.text())
    }
  })
  page.on('pageerror', error => problems.push(error.message))
  page.on('request', request => {
    if (!request.url().startsWith(`${baseURL}/`)) {
      elsewhere.push(request.url())
    }
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      console.error(
        `CSP violation: ${event.violatedDirective} ${event.blockedURI}`,
      )
    })
  })

  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Intone' }),
  ).toBeVisible()

  expect(problems).toStrictEqual([])
  expect(elsewhere).toStrictEqual([])
  await expect(
    page.locator('meta[http-equiv="Content-Security-Policy"]'),
  ).toHaveAttribute(
    'content',
    /^default-src 'self'; script-src 'self' 'wasm-unsafe-eval';/,
  )
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

test('each model file is served whole from its versioned same-origin path', async ({
  request,
}) => {
  for (const model of await readModelList(join(root, 'models.json'))) {
    const response = await request.get(`/${modelPath(model)}`)
    expect(response.status()).toBe(200)
    const body = await response.body()
    expect(createHash('sha256').update(body).digest('hex')).toBe(model.sha256)
  }
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
