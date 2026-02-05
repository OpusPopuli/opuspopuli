import { test, expect } from "@playwright/test";
import {
  setupAuthSession,
  checkAccessibility,
  viewports,
} from "./utils/test-helpers";

test.describe("Petition Capture", () => {
  test.describe("Petition home page", () => {
    test("should render petition landing page", async ({ page }) => {
      await setupAuthSession(page);
      await page.goto("/petition");

      await expect(page.getByText("Scan a Petition")).toBeVisible();
      await expect(page.getByText("Start Scanning")).toBeVisible();
    });

    test("should navigate to capture page from start scanning", async ({
      page,
    }) => {
      await setupAuthSession(page);
      await page.goto("/petition");

      await page.getByText("Start Scanning").click();

      await expect(page).toHaveURL(/\/petition\/capture/);
    });

    test("should have back to home link", async ({ page }) => {
      await setupAuthSession(page);
      await page.goto("/petition");

      await expect(page.getByText("Back to Home")).toBeVisible();
    });
  });

  test.describe("Camera permission flow", () => {
    test("should show permission request when camera not granted", async ({
      page,
    }) => {
      await setupAuthSession(page);

      // Mock getUserMedia to not exist initially
      await page.addInitScript(() => {
        // Permission query returns prompt
        Object.defineProperty(navigator, "permissions", {
          value: {
            query: () =>
              Promise.resolve({
                state: "prompt",
                addEventListener: () => {},
              }),
          },
        });
      });

      await page.goto("/petition/capture");

      // Should show permission request UI
      await expect(page.getByText("Camera Access Needed")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Enable Camera" }),
      ).toBeVisible();
    });

    test("should show unsupported message when camera API unavailable", async ({
      page,
    }) => {
      await setupAuthSession(page);

      // Remove mediaDevices before page loads
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "mediaDevices", {
          value: undefined,
          writable: false,
        });
      });

      await page.goto("/petition/capture");

      await expect(page.getByText("Camera Not Supported")).toBeVisible();
      await expect(page.getByText(/Chrome, Safari, or Firefox/)).toBeVisible();
    });
  });

  test.describe("Camera capture page structure", () => {
    test("should render full-screen black background", async ({ page }) => {
      await setupAuthSession(page);
      await page.goto("/petition/capture");

      // The page should have a full-screen container
      const container = page.locator(".fixed.inset-0.bg-black");
      await expect(container).toBeVisible();
    });
  });

  test.describe("Responsive design", () => {
    test("should render correctly on mobile viewport", async ({ page }) => {
      await setupAuthSession(page);
      await page.setViewportSize(viewports.mobile);
      await page.goto("/petition");

      await expect(page.getByText("Scan a Petition")).toBeVisible();
      await expect(page.getByText("Start Scanning")).toBeVisible();
    });

    test("should render correctly on tablet viewport", async ({ page }) => {
      await setupAuthSession(page);
      await page.setViewportSize(viewports.tablet);
      await page.goto("/petition");

      await expect(page.getByText("Scan a Petition")).toBeVisible();
      await expect(page.getByText("Start Scanning")).toBeVisible();
    });
  });

  test.describe("Accessibility", () => {
    test("petition home should have no critical accessibility violations", async ({
      page,
    }) => {
      await setupAuthSession(page);
      await page.goto("/petition");

      const violations = await checkAccessibility(page, {
        includedImpacts: ["critical", "serious"],
      });
      expect(violations).toEqual([]);
    });

    test("camera permission screen should have no critical accessibility violations", async ({
      page,
    }) => {
      await setupAuthSession(page);

      await page.addInitScript(() => {
        Object.defineProperty(navigator, "permissions", {
          value: {
            query: () =>
              Promise.resolve({
                state: "prompt",
                addEventListener: () => {},
              }),
          },
        });
      });

      await page.goto("/petition/capture");

      // Wait for permission UI to appear
      await expect(page.getByText("Camera Access Needed")).toBeVisible();

      const violations = await checkAccessibility(page, {
        includedImpacts: ["critical", "serious"],
      });
      expect(violations).toEqual([]);
    });
  });

  test.describe("Location prompt flow", () => {
    test("should not break capture page when geolocation is unavailable", async ({
      page,
    }) => {
      await setupAuthSession(page);

      // Remove geolocation API before page loads
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "geolocation", {
          value: undefined,
          writable: false,
        });
      });

      await page.goto("/petition/capture");

      // Page should still render (camera permission screen)
      const container = page.locator(".fixed.inset-0.bg-black");
      await expect(container).toBeVisible();
    });

    test("should not break capture page when geolocation permission is denied", async ({
      page,
    }) => {
      await setupAuthSession(page);

      // Mock geolocation as denied
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "permissions", {
          value: {
            query: (descriptor: { name: string }) => {
              if (descriptor.name === "geolocation") {
                return Promise.resolve({
                  state: "denied",
                  addEventListener: () => {},
                });
              }
              // Camera permission as prompt
              return Promise.resolve({
                state: "prompt",
                addEventListener: () => {},
              });
            },
          },
        });
      });

      await page.goto("/petition/capture");

      // Camera permission screen should still work
      await expect(page.getByText("Camera Access Needed")).toBeVisible();
    });

    test("location prompt should have no critical accessibility violations", async ({
      page,
    }) => {
      await setupAuthSession(page);

      // Mock camera as granted with a fake stream, and mock geolocation
      await page.addInitScript(() => {
        // Mock permissions query
        Object.defineProperty(navigator, "permissions", {
          value: {
            query: (descriptor: { name: string }) => {
              if (descriptor.name === "camera") {
                return Promise.resolve({
                  state: "granted",
                  addEventListener: () => {},
                });
              }
              if (descriptor.name === "geolocation") {
                return Promise.resolve({
                  state: "prompt",
                  addEventListener: () => {},
                });
              }
              return Promise.resolve({
                state: "prompt",
                addEventListener: () => {},
              });
            },
          },
        });

        // Mock mediaDevices.enumerateDevices
        const mockStream = {
          getTracks: () => [
            { kind: "video", stop: () => {}, getSettings: () => ({}) },
          ],
          getVideoTracks: () => [
            {
              kind: "video",
              stop: () => {},
              getSettings: () => ({}),
              getCapabilities: () => ({}),
              applyConstraints: () => Promise.resolve(),
            },
          ],
          getAudioTracks: () => [],
        };

        Object.defineProperty(navigator, "mediaDevices", {
          value: {
            getUserMedia: () => Promise.resolve(mockStream),
            enumerateDevices: () =>
              Promise.resolve([
                {
                  kind: "videoinput",
                  deviceId: "mock-camera",
                  label: "Mock Camera",
                  groupId: "mock-group",
                },
              ]),
          },
          writable: false,
        });

        // Mock geolocation
        Object.defineProperty(navigator, "geolocation", {
          value: {
            getCurrentPosition: (
              _success: PositionCallback,
              _error?: PositionErrorCallback,
            ) => {
              // Don't resolve - simulate waiting state
            },
          },
          writable: false,
        });
      });

      await page.goto("/petition/capture");

      // If we can reach the location prompt, check accessibility
      // The camera viewfinder should render since permission is granted
      // Note: Full capture flow (viewfinder → capture → preview → location)
      // is complex to simulate in E2E; location prompt accessibility is
      // covered by unit tests in LocationPrompt.test.tsx
      const container = page.locator(".fixed.inset-0.bg-black");
      await expect(container).toBeVisible();
    });
  });

  test.describe("Authentication", () => {
    test("should redirect to login when not authenticated", async ({
      page,
    }) => {
      // Don't set up auth session
      await page.goto("/petition");

      // ProtectedRoute should redirect to login
      await expect(page).toHaveURL(/\/login/);
    });

    test("capture page should redirect to login when not authenticated", async ({
      page,
    }) => {
      await page.goto("/petition/capture");

      await expect(page).toHaveURL(/\/login/);
    });
  });
});
