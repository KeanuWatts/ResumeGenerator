import { test, expect } from "@playwright/test";

const ROUTES = [
  { path: "/", name: "Home" },
  { path: "/login", name: "Login" },
  { path: "/register", name: "Register" },
  { path: "/forgot-password", name: "Forgot password" },
  { path: "/reset-password", name: "Reset password" },
  { path: "/dashboard", name: "Dashboard" },
  { path: "/resumes", name: "Resumes" },
  { path: "/jobs", name: "Jobs" },
  { path: "/jobs/new", name: "New job" },
  { path: "/generate", name: "Generate" },
  { path: "/documents", name: "Documents" },
  { path: "/settings", name: "Settings" },
];

test.describe("Phase 0 smoke: all routes render and navigation works", () => {
  for (const { path, name } of ROUTES) {
    test(`${name} (${path}) loads without crash`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("body")).toBeVisible();
    });
  }

  test("home links to login and register", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /log in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await page.getByRole("link", { name: /register/i }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test("dashboard nav links are present", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /resumes/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /jobs/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /generate/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /documents/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toBeVisible();
  });
});
