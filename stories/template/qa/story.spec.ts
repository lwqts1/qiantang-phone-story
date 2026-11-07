import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const story = JSON.parse(readFileSync(new URL('../story.json', import.meta.url), 'utf8'));
const ending = story.tests[0].ending;
const itinerary = story.content.notes.find((item: { id: string }) => item.id === 'note-trip');
const privateNote = story.content.notes.find((item: { id: string }) => item.id === 'note-truth');
async function home(page: Page) {
  await page.getByRole('button', { name: '返回桌面', exact: true }).click();
}
async function open(page: Page, name: string) {
  await home(page);
  await page.getByRole('button', { name: '打开' + name, exact: true }).click();
  await expect(page.locator('.app-screen:not([inert])')).toHaveCSS('transform', 'none');
}
async function note(page: Page, title: string) {
  await open(page, '备忘录');
  await page.locator('.notes-list button').filter({ hasText: title }).click();
}
async function unlock(page: Page) {
  await page.getByRole('button', { name: '轻触解锁', exact: true }).click();
  for (const digit of story.phone.passcode) await page.getByRole('button', { name: '密码键' + digit, exact: true }).click();
}
async function saved(page: Page, completedNode: string) {
  // IndexedDB writes are asynchronous: verify the actual save before reload.
  await expect.poll(() => page.evaluate(async ({ workId, nodeId }) => {
    return new Promise<boolean>((resolve, reject) => {
      const request = indexedDB.open('foundphone-studio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('saves', 'readonly');
        const get = tx.objectStore('saves').get(workId);
        get.onsuccess = () => resolve(!!get.result?.state.completed.includes(nodeId));
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => db.close();
      };
    });
  }, { workId: story.id, nodeId: completedNode })).toBe(true);
}
async function prepare(page: Page) {
  await page.goto('/');
  await unlock(page);
  await open(page, '微信');
  const visibleChats = story.chats.filter((chat: { app: string; messages: { hidden?: boolean }[] }) => chat.app === 'wechat' && chat.messages.some(m => !m.hidden));
  await expect(page.locator('.wx-chat-row')).toHaveCount(visibleChats.length);
  await open(page, '备忘录');
  await expect(page.locator('.notes-list')).not.toContainText('没有说出口的事');
  await expect(page.locator('.notes-list')).not.toContainText('那场雨');
  await note(page, '今晚｜去江边走走');
  await note(page, itinerary.title);
  await expect(page.locator('.native-note-paper')).toContainText(itinerary.body);
  await page.locator('.phone-screen').screenshot({ path: 'outputs/qiantang/itinerary.png' });
  await note(page, '住院照护交接');
  await open(page, '钱包');
  await page.getByRole('button').filter({ hasText: '住院垫付记录' }).click();
  await note(page, '那场雨｜我知道的经过');
  await open(page, '邮件');
  await page.locator('.mail-preview').filter({ hasText: '项目取消通知' }).click();
  // Restore a mid-story save through the actual browser, then continue in UI.
  await saved(page, 'gate-truth');
  await page.reload();
  await unlock(page);
  await note(page, '没有说出口的事');
  await page.getByPlaceholder('内容密码').fill(privateNote.password + '-wrong');
  await page.getByRole('button', { name: '解锁内容', exact: true }).click();
  await expect(page.getByText('密码不正确', { exact: true })).toBeVisible();
  await expect(page.locator('.incoming-call-screen')).toHaveCount(0);
  await page.getByPlaceholder('内容密码').fill(privateNote.password);
  await page.getByRole('button', { name: '解锁内容', exact: true }).click();
  await expect(page.locator('.native-note-paper')).toContainText('今天妈知道了');
  await expect(page.locator('.incoming-call-screen')).toContainText('方小米');
}
test('完整阅读：来电、日记、结局与存档', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await prepare(page);
  await page.getByRole('button', { name: '接听', exact: true }).click();
  await page.getByRole('button', { name: '挂断', exact: true }).click();
  await note(page, '江边｜归还手机的地点');
  await page.getByRole('button', { name: '读完日记摘记，再归还', exact: true }).click();
  await saved(page, 'read-diary-first');
  await page.reload();
  await unlock(page);
  await open(page, '文件');
  await page.locator('.file-grid button').filter({ hasText: '方小米的日记｜转交摘记' }).click();
  await page.getByRole('button', { name: '把手机交还陆亚飞', exact: true }).click();
  await expect(page.locator('.story-overlay.ending p')).toHaveText(ending);
  await page.locator('.phone-screen').screenshot({ path: 'outputs/qiantang/ending.png' });
  await saved(page, 'ending-warm');
  await page.reload();
  await unlock(page);
  await expect(page.locator('.story-overlay.ending p')).toHaveText(ending);
  expect(errors).toEqual([]);
});
test('移动视口：拒接、直接归还和重新开始', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const rect = await page.locator('.phone-shell').boundingBox();
  expect(rect!.width).toBeLessThanOrEqual(390);
  expect(rect!.height).toBeLessThanOrEqual(844);
  await page.getByRole('button', { name: '拒接', exact: true }).click();
  await note(page, '江边｜归还手机的地点');
  await saved(page, 'choice-return');
  await page.reload();
  await unlock(page);
  await page.getByRole('button', { name: '现在归还手机', exact: true }).click();
  await expect(page.locator('.story-overlay.ending p')).toHaveText(ending);
  await page.screenshot({ path: 'outputs/qiantang/mobile-ending.png' });
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await unlock(page);
  await open(page, '备忘录');
  await expect(page.locator('.notes-list')).not.toContainText('那场雨');
  await expect(page.locator('.notes-list')).not.toContainText('江边｜归还');
  await expect(page.locator('.story-overlay')).toHaveCount(0);
});

test('地图日期、六个剧场标记、支付宝转账与吃饭互动', async ({ page }) => {
  await page.goto('/');
  await unlock(page);
  await open(page, '地图');
  await expect(page.locator('.map-pin')).toHaveCount(6);
  for (const item of story.content.calendar) {
    await expect(page.locator('.map-places button').filter({ hasText: item.title })).toContainText(item.time);
  }
  await open(page, '支付宝');
  await expect(page.locator('.alipay-bill').filter({ hasText: '转账给方小米' })).toContainText('-¥80,000.00');
  await open(page, '抖音');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.douyin-ui')).not.toContainText('六城巡演即将启程');
  await open(page, '小红书');
  await expect(page.locator('.redbook-masonry')).not.toContainText('《钱塘里》六城巡演 观演攻略');
  await open(page, '微博');
  await expect(page.locator('.app-screen:not([inert])')).not.toContainText('越剧《钱塘里》六城巡演，正式启程！');
  await open(page, '相册');
  await expect(page.getByRole('button', { name: '查看窗边留影' })).toBeVisible();
  for (const chat of story.chats.filter((c: { id: string }) => ['chat-mother', 'chat-xiaomi'].includes(c.id))) {
    await open(page, '微信');
    await page.locator('.wx-chat-row').filter({ hasText: chat.title }).click();
    const messages = chat.messages.filter((m: { id: string }) => m.id.startsWith('dinner-'));
    await expect(page.getByRole('button', { name: messages[1].body, exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: messages[0].body, exact: false }).click();
    await page.getByRole('button', { name: messages[1].body, exact: false }).click();
    await expect(page.getByRole('button', { name: messages[2].body, exact: false })).toBeVisible();
  }
});

test('北京时间跨日并自动更新锁屏时间', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T15:59:58Z') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '23:59', exact: true })).toBeVisible();
  await page.clock.fastForward(3000);
  await expect(page.getByRole('heading', { name: '00:00', exact: true })).toBeVisible();
  await expect(page.getByText('1月1日星期五', { exact: true })).toBeVisible();
});

test('夏季主线解锁六城宣传，集齐后可归还手机', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '拒接', exact: true }).click();
  await note(page, '江边｜归还手机的地点');
  await page.getByRole('button', { name: '读完日记摘记，再归还', exact: true }).click();
  await open(page, '文件');
  await page.locator('.file-grid button').filter({ hasText: '方小米的日记｜转交摘记' }).click();
  await page.getByRole('button', { name: '先查看六城巡演彩蛋', exact: true }).click();
  await note(page, '戏外彩蛋｜《钱塘里》六城巡演');
  for (const item of story.content.calendar) {
    await open(page, '日历');
    const month = Number(item.time.slice(5, 7));
    for (let n = 0; n < 4 && !(await page.locator('.month-title').innerText()).includes(`2026 年 ${month} 月`); n++) {
      await page.getByRole('button', { name: '下个月', exact: true }).click();
    }
    await page.locator('.calendar-grid').getByRole('button', { name: String(Number(item.time.slice(8, 10))), exact: true }).click();
    await page.locator('.calendar-event').filter({ hasText: item.title }).click();
  }
  await saved(page, 'tour-complete');
  await page.reload();
  await unlock(page);
  await note(page, '六城已点亮｜剧场见');
  await page.getByRole('button', { name: '把手机交还陆亚飞', exact: true }).click();
  await expect(page.locator('.story-overlay.ending p')).toHaveText(ending);
});

test('日历每次打开默认选中北京时间今天', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-04T16:30:00Z') });
  await page.goto('/');
  await unlock(page);
  await open(page, '日历');
  await expect(page.locator('.month-title')).toContainText('2026 年 11 月');
  await expect(page.locator('.calendar-grid button.selected')).toHaveText('5');
  await page.getByRole('button', { name: '下个月', exact: true }).click();
  await open(page, '备忘录');
  await open(page, '日历');
  await expect(page.locator('.month-title')).toContainText('2026 年 11 月');
  await expect(page.locator('.calendar-grid button.selected')).toHaveText('5');
});

 test('锁屏密码1223', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '轻触解锁', exact: true }).click();
  for (const digit of '0000') await page.getByRole('button', { name: '密码键' + digit, exact: true }).click();
  await expect(page.getByText('密码不正确', { exact: true })).toBeVisible();
  await page.getByLabel('锁屏密码', { exact: true }).fill('1223');
  await page.getByLabel('锁屏密码', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: '打开备忘录', exact: true })).toBeVisible();
});

test('海报墙纸在锁屏和桌面显示', async ({ page }) => {
  await page.goto('/');
  const screen = page.locator('.phone-screen');
  await expect(screen).toHaveClass(/wallpaper-custom/);
  expect(await screen.evaluate(el => el.style.backgroundImage.includes('data:image/jpeg;base64,'))).toBe(true);
  expect(await page.evaluate(src => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = src;
  }), story.phone.wallpaper)).toBe(true);
  await expect(page.locator('.wallpaper-orb')).toHaveCount(0);
  await screen.screenshot({ path: 'outputs/qiantang/poster-lock.png' });
  await unlock(page);
  await expect(screen).not.toHaveClass(/is-locked/);
  await expect(screen).toHaveClass(/wallpaper-custom/);
  await screen.screenshot({ path: 'outputs/qiantang/poster-home.png' });
});

test('每条微信消息显示完整日期时间', async ({ page }) => {
  await page.goto('/');
  await unlock(page);
  for (const chat of story.chats.filter((c: { messages: { hidden?: boolean }[] }) => c.messages.some(m => !m.hidden))) {
    await open(page, '微信');
    await page.locator('.wx-chat-row').filter({ hasText: chat.title }).click();
    const times = page.locator('.wx-message-time');
    expect(await times.count()).toBeGreaterThan(0);
    for (const time of await times.all()) {
      await expect(time).toBeVisible();
      await expect(time).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*$/);
    }
  }
  await page.locator('.phone-screen').screenshot({ path: 'outputs/qiantang/chat-dates.png' });
});

test('旧存档恢复微博桌面图标', async ({ page }) => {
  await page.goto('/');
  await unlock(page);
  await expect(page.getByRole('button', { name: '打开微博', exact: true })).toBeVisible();
  await page.evaluate(id => {
    const key = 'foundphone-layout-v1:' + id;
    const layout = JSON.parse(localStorage.getItem(key)!);
    Object.assign(layout.apps.find((a: { id: string }) => a.id === 'weibo'), { installed: false, visible: false, folder: '旧文件夹' });
    layout.previewLayoutRevision = 0;
    localStorage.setItem(key, JSON.stringify(layout));
  }, story.id);
  await page.reload();
  await unlock(page);
  await expect(page.getByRole('button', { name: '打开微博', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开微博', exact: true }).click();
  await expect(page.locator('.weibo-ui')).toBeVisible();
});

test('锁屏同时显示两条提醒', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.lock-screen .device-notice')).toHaveCount(2);
  for (const card of await page.locator('.lock-screen .device-notice').all()) {
    await expect(card).toBeVisible();
    await expect(card).toBeInViewport();
  }
  await expect(page.getByRole('button', { name: '2 条通知', exact: true })).toHaveCount(0);
  await page.locator('.phone-screen').screenshot({ path: 'outputs/qiantang/two-lock-notices.png' });
});
