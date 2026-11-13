import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { readModelList, servedModelFiles } from '../../build/models.ts'

// The local production build in Chromium: each file of the small models
// is fetched once, and on the next visit comes from the browser's own
// cache, as the immutable caching of a model directory promises.

const root = join(import.meta.dirname, '..', '..')
const cachedModels = ['swift-f0', 'silero-vad']

type Timing = Readonly<{
  url: string
  transferSize: number
  decodedBodySize: number
}>

test('each file of SwiftF0 and Silero VAD comes from the browser cache on the next visit', async ({
  page,
  baseURL,
}) => {
  const files = servedModelFiles(
    await readModelList(join(root, 'models.json')),
  ).filter(({ model }) => cachedModels.includes(model.id))
  expect(files.map(({ model }) => model.id).sort()).toStrictEqual(
    [...cachedModels].sort(),
  )
  const urls = files.map(({ path }) => `${baseURL}/${path}`)
  const requests: Array<Readonly<{ url: string; hasBody: boolean }>> = []
  page.on('request', request =>
    requests.push({
      url: request.url(),
      hasBody: request.postDataBuffer() !== null,
    }),
  )

  // Fetches each file from the page, then reads its Resource Timing.
  const fetchEach = (): Promise<ReadonlyArray<Timing>> =>
    page.evaluate(async (urls: ReadonlyArray<string>) => {
      for (const url of urls) {
        const response = await fetch(url)
        await response.arrayBuffer()
      }
      return urls.map(url => {
        const entry = performance
          .getEntriesByName(url, 'resource')
          .filter(
            (each): each is PerformanceResourceTiming =>
              each instanceof PerformanceResourceTiming,
          )
          .at(-1)
        return {
          url,
          transferSize: entry?.transferSize ?? -1,
          decodedBodySize: entry?.decodedBodySize ?? -1,
        }
      })
    }, urls)

  const opened = async (): Promise<void> => {
    await expect(
      page.getByRole('heading', { level: 1, name: 'Intone' }),
    ).toBeVisible()
  }

  await page.goto('/')
  await opened()
  const first = await fetchEach()
  await page.reload()
  await opened()
  const second = await fetchEach()

  for (const [index, { file }] of files.entries()) {
    expect(first[index]?.decodedBodySize, urls[index]).toBe(file.bytes)
    expect(first[index]?.transferSize, urls[index]).toBeGreaterThan(file.bytes)
    expect(second[index], urls[index]).toStrictEqual({
      url: urls[index],
      transferSize: 0,
      decodedBodySize: file.bytes,
    })
  }
  expect(
    requests.filter(request => !request.url.startsWith(`${baseURL}/`)),
  ).toStrictEqual([])
  expect(requests.filter(request => request.hasBody)).toStrictEqual([])
})
