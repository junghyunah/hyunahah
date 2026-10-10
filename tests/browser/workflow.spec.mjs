import {test,expect} from '@playwright/test';

test('mobile participant signs, separate administrator sees submission and downloads PDF',async({browser})=>{
  const mobile=await browser.newContext({viewport:{width:390,height:844}});
  const page=await mobile.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#headerOrgName')).toHaveText('테스트복지관');
  await page.locator('#partInputName').fill('테스트가');await page.locator('#partInputBirth').fill('19400101');
  await page.locator('#participantLoginCard button[type=submit]').click();await expect(page.locator('#participantCourseCard')).toBeVisible();
  for(const id of [2,3,4]){
    await page.locator(`#checkCourse-${id}`).check();
    const canvas=page.locator(`#canvas-${id}`);await canvas.scrollIntoViewIfNeeded();
    const box=await canvas.boundingBox();await page.mouse.move(box.x+20,box.y+30);await page.mouse.down();await page.mouse.move(box.x+120,box.y+70,{steps:10});await page.mouse.up();
  }
  await page.locator('#partFinalSubmitBtn').click();await expect(page.locator('#participantSuccessCard')).toBeVisible();
  const adminContext=await browser.newContext();const admin=await adminContext.newPage();admin.on('pageerror',e=>errors.push(e.message));
  await admin.goto('/?mode=admin');await admin.locator('#adminInputPassword').fill('test-password-12345');await admin.locator('#adminLoginCard button[type=submit]').click();
  await expect(admin.locator('#adminWorkspace')).toBeVisible();
  const response=await admin.request.get('/api/state');const state=await response.json();expect(state.state.submissions[0].completedCourseIds).toHaveLength(3);
  const pdf=await admin.request.get('/api/pdf?participant=p1&date=2026-10-01');expect(pdf.ok()).toBeTruthy();expect((await pdf.body()).subarray(0,4).toString()).toBe('%PDF');
  const unauthorized=await page.request.get('/api/pdf?participant=p1&date=2026-10-01');expect(unauthorized.status()).toBe(401);
  expect(errors).toEqual([]);await mobile.close();await adminContext.close();
});

test('administrator persists settings after reload',async({page})=>{
  await page.goto('/?mode=admin');await page.locator('#adminInputPassword').fill('test-password-12345');await page.locator('#adminLoginCard button[type=submit]').click();
  await page.locator('#adminTabBtn-settings').click();await page.locator('#settingOrgNameInput').fill('변경복지관');
  await page.getByRole('button',{name:/설정 저장/}).click();await expect(page.locator('#headerOrgName')).toHaveText('변경복지관');
  await page.reload();await page.locator('#adminInputPassword').fill('test-password-12345');await page.locator('#adminLoginCard button[type=submit]').click();await expect(page.locator('#headerOrgName')).toHaveText('변경복지관');
});
