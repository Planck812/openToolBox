import assert from 'node:assert/strict';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 创建桌面测试上下文，统一封装常用等待与交互。
 * @param {import('webdriverio').Browser} browser WebdriverIO 浏览器实例
 * @param {string} artifactDir 失败截图目录
 */
export function createDesktopSession(browser, artifactDir) {
  const selectorByTestId = (testId) => `[data-testid="${testId}"]`;
  let currentSpec = null;
  let automaticScreenshotsAllowed = true;

  return {
    browser,
    artifactDir,
    assert,
    selectorByTestId,
    setCurrentSpec(specState) {
      currentSpec = specState;
      automaticScreenshotsAllowed = true;
    },
    setAutomaticScreenshotsAllowed(allowed) {
      automaticScreenshotsAllowed = Boolean(allowed);
    },
    canTakeAutomaticScreenshot() {
      return automaticScreenshotsAllowed;
    },
    async waitForSelector(selector, timeout = DEFAULT_TIMEOUT_MS) {
      const element = await browser.$(selector);
      await element.waitForExist({ timeout });
      return element;
    },
    async expectVisible(selector, timeout = DEFAULT_TIMEOUT_MS) {
      const element = await this.waitForSelector(selector, timeout);
      await element.waitForDisplayed({ timeout });
      return element;
    },
    async expectTestIdVisible(testId, timeout = DEFAULT_TIMEOUT_MS) {
      return this.expectVisible(selectorByTestId(testId), timeout);
    },
    async clickTestId(testId, timeout = DEFAULT_TIMEOUT_MS) {
      const element = await this.expectTestIdVisible(testId, timeout);
      await element.click();
      return element;
    },
    async setValueByTestId(testId, value, timeout = DEFAULT_TIMEOUT_MS) {
      const element = await this.expectTestIdVisible(testId, timeout);
      await element.clearValue();
      await element.setValue(value);
      return element;
    },
    async getValueByTestId(testId, timeout = DEFAULT_TIMEOUT_MS) {
      const element = await this.expectTestIdVisible(testId, timeout);
      return element.getValue();
    },
    async expectPageContains(text, timeout = DEFAULT_TIMEOUT_MS) {
      await browser.waitUntil(
        async () => (await browser.getPageSource()).includes(text),
        {
          timeout,
          timeoutMsg: `页面在 ${timeout}ms 内未出现文本: ${text}`,
        },
      );
    },
    async openTool(toolId, timeout = DEFAULT_TIMEOUT_MS) {
      await this.clickTestId(`tool-card-${toolId}`, timeout);
      await this.expectTestIdVisible('tool-view', timeout);
    },
    async goHome(timeout = DEFAULT_TIMEOUT_MS) {
      const backButton = await browser.$('[data-testid="tool-back-button"]');
      if (await backButton.isExisting()) {
        await backButton.click();
      }
      await this.expectTestIdVisible('home-view', timeout);
    },
    async saveScreenshot(name, prefix = 'snapshot', metadata = {}) {
      const fileName = `${Date.now()}-${prefix}-${name.replace(/[^a-z0-9-_]/gi, '-').toLowerCase()}.png`;
      const output = `${artifactDir}/${fileName}`;
      await browser.saveScreenshot(output);

      if (currentSpec) {
        currentSpec.screenshots.push({
          title: metadata.title || name,
          filePath: output,
          kind: metadata.kind || prefix,
          timestamp: new Date().toISOString(),
        });
      }

      return output;
    },
    async recordStep(title, name = title) {
      return this.saveScreenshot(name, 'step', {
        title,
        kind: 'step',
      });
    },
    async takeFailureScreenshot(name, title = '失败现场') {
      return this.saveScreenshot(name, 'failure', {
        title,
        kind: 'failure',
      });
    },
    async takeSuccessScreenshot(name, title = '最终通过态') {
      return this.saveScreenshot(name, 'success', {
        title,
        kind: 'success',
      });
    },
  };
}
