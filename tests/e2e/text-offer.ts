import { type Page, expect } from '@playwright/test'

// An upload's level offers the text model's download as it opens, in a
// modal dialog, until the learner answers it once (src/app/text/). A
// spec about something else says "Not now", which is kept, so the
// level, and every later upload in the same browser, is as before.
export const declineTextModel = async (page: Page): Promise<void> => {
  const dialog = page.getByRole('dialog', { name: 'Download the text model?' })
  await dialog.getByRole('button', { name: 'Not now' }).click()
  await expect(dialog).toHaveCount(0)
}
