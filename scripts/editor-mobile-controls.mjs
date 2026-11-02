// Browser checks use the same contextual navigation as a person on a phone.
export async function openEditorTool(page, id) {
  if (!(await page.locator('.pe-tabs').isVisible())) return;
  if (await page.locator('.pe').getAttribute('data-mobile-panel') !== 'adjust') {
    await page.locator('.pe-tabs').getByRole('button', { name: 'Adjust', exact: true }).click();
  }
  if (await page.locator('.pe').getAttribute('data-mobile-tool') === id) return;
  const select = page.getByLabel('Editing tool', { exact: true });
  if (await select.isVisible()) await select.selectOption(id);
  else await page.locator(`[data-mobile-choice="${id}"]`).click();
}

export async function editorOptions(page, open) {
  const button = page.getByRole('button', { name: 'More editor options', exact: true });
  if (await button.isVisible() && (await button.getAttribute('aria-expanded') === 'true') !== open) await button.click();
}
