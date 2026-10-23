import { test, expect } from "@playwright/test";
test("compact sign-in fits desktop and phone viewports and respects motion controls", async ({
  page,
}) => {
  for (const [width, height] of [
    [1366, 649],
    [1440, 900],
    [360, 640],
    [390, 844],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Enter workspace" }),
    ).toBeVisible();
    const metrics = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      leftHeight: document.querySelector(".login-left")!.scrollHeight,
      leftClient: document.querySelector(".login-left")!.clientHeight,
      buttonBottom: document
        .querySelector(".login-submit")!
        .getBoundingClientRect().bottom,
    }));
    expect(
      metrics.height,
      `document height at ${width}x${height}`,
    ).toBeLessThanOrEqual(height);
    expect(metrics.width).toBeLessThanOrEqual(width);
    expect(
      metrics.leftHeight,
      `form height at ${width}x${height}`,
    ).toBeLessThanOrEqual(metrics.leftClient);
    expect(metrics.buttonBottom).toBeLessThanOrEqual(height);
    await page.screenshot({
      path: `work/login-${width}x${height}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1366, height: 649 });
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(page.locator(".studio-scene")).toHaveAttribute(
    "data-paused",
    "true",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByText("Reduced motion", { exact: true })).toBeVisible();
  expect(
    await page
      .locator(".creative-browser")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  expect(await page.locator('link[rel="icon"]').getAttribute("href")).toBe(
    "/icon.svg",
  );
});
