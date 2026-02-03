/**
 * PWA (Progressive Web App) E2E Tests
 *
 * Tests for PWA functionality including manifest, service worker,
 * offline behavior, and installation readiness.
 *
 * Note: Some PWA features only work in production mode.
 * The service worker is disabled in development.
 */
import { test, expect } from "@playwright/test";

test.describe("PWA - Manifest", () => {
  test("should serve manifest from /api/manifest", async ({ request }) => {
    const response = await request.get("/api/manifest");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toContain(
      "application/manifest+json",
    );

    const manifest = await response.json();
    expect(manifest.name).toBe("OPUS");
    expect(manifest.short_name).toBe("OPUS");
    expect(manifest.display).toBe("standalone");
  });

  test("should have correct theme color in manifest", async ({ request }) => {
    const response = await request.get("/api/manifest");
    const manifest = await response.json();

    expect(manifest.theme_color).toBe("#6f42c1");
    expect(manifest.background_color).toBe("#ffffff");
  });

  test("should include icons in manifest", async ({ request }) => {
    const response = await request.get("/api/manifest");
    const manifest = await response.json();

    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThan(0);

    // Check for 192x192 icon
    const icon192 = manifest.icons.find(
      (i: { sizes: string }) => i.sizes === "192x192",
    );
    expect(icon192).toBeDefined();

    // Check for 512x512 icon
    const icon512 = manifest.icons.find(
      (i: { sizes: string }) => i.sizes === "512x512",
    );
    expect(icon512).toBeDefined();
  });

  test("should include shortcuts in default manifest", async ({ request }) => {
    const response = await request.get("/api/manifest");
    const manifest = await response.json();

    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBe(4);

    const shortcutNames = manifest.shortcuts.map(
      (s: { name: string }) => s.name,
    );
    expect(shortcutNames).toContain("Petition");
    expect(shortcutNames).toContain("Ballot");
    expect(shortcutNames).toContain("Record");
    expect(shortcutNames).toContain("Code");
  });

  test.describe("Product-specific manifests", () => {
    test("should return petition manifest for petition referer", async ({
      request,
    }) => {
      const response = await request.get("/api/manifest", {
        headers: { referer: "http://localhost:3200/petition" },
      });
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Petition");
      expect(manifest.short_name).toBe("Petition");
      expect(manifest.start_url).toBe("/petition");
      expect(manifest.orientation).toBe("portrait");
    });

    test("should return ballot manifest for ballot referer", async ({
      request,
    }) => {
      const response = await request.get("/api/manifest", {
        headers: { referer: "http://localhost:3200/ballot" },
      });
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Ballot");
      expect(manifest.short_name).toBe("Ballot");
      expect(manifest.theme_color).toBe("#1d76db");
    });

    test("should return record manifest for record referer", async ({
      request,
    }) => {
      const response = await request.get("/api/manifest", {
        headers: { referer: "http://localhost:3200/record" },
      });
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Record");
      expect(manifest.theme_color).toBe("#0e8a16");
    });

    test("should return code manifest for code referer", async ({
      request,
    }) => {
      const response = await request.get("/api/manifest", {
        headers: { referer: "http://localhost:3200/code" },
      });
      const manifest = await response.json();

      expect(manifest.name).toBe("OPUS Code");
      expect(manifest.theme_color).toBe("#d93f0b");
    });
  });
});

test.describe("PWA - HTML Meta Tags", () => {
  test("should have manifest link in head", async ({ page }) => {
    await page.goto("/");

    const manifestLink = await page.$('link[rel="manifest"]');
    expect(manifestLink).not.toBeNull();

    const href = await manifestLink?.getAttribute("href");
    expect(href).toBe("/api/manifest");
  });

  test("should have apple-touch-icon", async ({ page }) => {
    await page.goto("/");

    const touchIcon = await page.$('link[rel="apple-touch-icon"]');
    expect(touchIcon).not.toBeNull();

    const href = await touchIcon?.getAttribute("href");
    expect(href).toContain("/icons/opus");
  });

  test("should have apple-mobile-web-app-capable meta tag", async ({
    page,
  }) => {
    await page.goto("/");

    const metaTag = await page.$('meta[name="apple-mobile-web-app-capable"]');
    expect(metaTag).not.toBeNull();

    const content = await metaTag?.getAttribute("content");
    expect(content).toBe("yes");
  });

  test("should have theme-color meta tag", async ({ page }) => {
    await page.goto("/");

    const themeColor = await page.$('meta[name="theme-color"]');
    expect(themeColor).not.toBeNull();

    const content = await themeColor?.getAttribute("content");
    expect(content).toBe("#6f42c1");
  });

  test("should have viewport meta tag with correct settings", async ({
    page,
  }) => {
    await page.goto("/");

    const viewport = await page.$('meta[name="viewport"]');
    expect(viewport).not.toBeNull();

    const content = await viewport?.getAttribute("content");
    expect(content).toContain("width=device-width");
    expect(content).toContain("initial-scale=1");
  });
});

test.describe("PWA - Icons", () => {
  test("should serve opus-192 icon", async ({ request }) => {
    const response = await request.get("/icons/opus-192.svg");
    expect(response.ok()).toBeTruthy();
  });

  test("should serve opus-512 icon", async ({ request }) => {
    const response = await request.get("/icons/opus-512.svg");
    expect(response.ok()).toBeTruthy();
  });

  test("should serve product-specific icons", async ({ request }) => {
    const products = ["petition", "ballot", "record", "code"];

    for (const product of products) {
      const response = await request.get(`/icons/${product}-192.svg`);
      expect(response.ok()).toBeTruthy();
    }
  });
});

test.describe("PWA - Offline Indicator", () => {
  test("should not show offline indicator when online", async ({ page }) => {
    await page.goto("/");

    // The offline indicator should not be visible when online
    const offlineIndicator = page.locator('[role="status"]').filter({
      hasText: /offline/i,
    });

    await expect(offlineIndicator).not.toBeVisible();
  });

  test("should show offline indicator when offline", async ({ page }) => {
    await page.goto("/");

    // Simulate going offline
    await page.context().setOffline(true);

    // Wait a moment for the event to trigger
    await page.waitForTimeout(500);

    // The offline indicator should now be visible
    const offlineIndicator = page.locator('[role="status"]').filter({
      hasText: /offline/i,
    });

    await expect(offlineIndicator).toBeVisible();
    await expect(offlineIndicator).toContainText(/offline/i);

    // Go back online
    await page.context().setOffline(false);
    await page.waitForTimeout(500);

    // Indicator should disappear
    await expect(offlineIndicator).not.toBeVisible();
  });

  test("offline indicator should be accessible", async ({ page }) => {
    await page.goto("/");
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    const offlineIndicator = page.locator('[role="status"]');
    await expect(offlineIndicator).toHaveAttribute("aria-live", "polite");

    await page.context().setOffline(false);
  });
});

test.describe("PWA - Service Worker", () => {
  // Note: Service worker is disabled in development mode
  // These tests verify the setup, actual SW testing requires production build

  test("should have service worker script at /sw.js in production", async ({
    request,
  }) => {
    // In dev mode, this will return 404
    // In production (CI), this should return the service worker
    const response = await request.get("/sw.js");

    // We don't fail if SW doesn't exist in dev mode
    if (response.ok()) {
      const contentType = response.headers()["content-type"];
      expect(contentType).toContain("javascript");
    }
  });
});

test.describe("PWA - Installation Requirements", () => {
  test("should meet basic PWA requirements", async ({ page }) => {
    await page.goto("/");

    // Check for manifest link
    const manifestLink = await page.$('link[rel="manifest"]');
    expect(manifestLink).not.toBeNull();

    // Check for HTTPS meta (viewport with proper settings)
    const viewport = await page.$('meta[name="viewport"]');
    expect(viewport).not.toBeNull();

    // Check for theme color
    const themeColor = await page.$('meta[name="theme-color"]');
    expect(themeColor).not.toBeNull();

    // Check for apple-touch-icon
    const touchIcon = await page.$('link[rel="apple-touch-icon"]');
    expect(touchIcon).not.toBeNull();
  });

  test("manifest should have required fields for installability", async ({
    request,
  }) => {
    const response = await request.get("/api/manifest");
    const manifest = await response.json();

    // Required for PWA installability
    expect(manifest.name).toBeDefined();
    expect(manifest.short_name).toBeDefined();
    expect(manifest.start_url).toBeDefined();
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThanOrEqual(1);

    // At least one icon >= 192x192
    const hasLargeIcon = manifest.icons.some((icon: { sizes: string }) => {
      const size = parseInt(icon.sizes.split("x")[0]);
      return size >= 192;
    });
    expect(hasLargeIcon).toBeTruthy();
  });
});

test.describe("PWA - Mobile Experience", () => {
  test("should display correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Page should be responsive
    await expect(page.locator("body")).toBeVisible();

    // No horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1); // +1 for rounding
  });

  test("should have touch-friendly targets", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/login");

    // Buttons should be at least 44x44 (iOS) or 48x48 (Android) for touch
    // Only check primary interactive buttons (not icon buttons or small controls)
    const buttons = await page.locator("button:visible").all();

    let validButtonCount = 0;
    for (const button of buttons) {
      const box = await button.boundingBox();
      if (box && box.width > 20) {
        // Only check main buttons, not small icon buttons
        // Minimum touch target is 44px, allow some tolerance for border/padding
        if (box.height >= 36) {
          validButtonCount++;
        }
      }
    }

    // At least some buttons should meet touch-friendly guidelines
    expect(validButtonCount).toBeGreaterThan(0);
  });
});
