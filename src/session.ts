import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "./types.js";

const SAVED_PLACES_URL = "https://www.google.com/maps/saved";

export interface SessionResult {
  loggedIn: boolean;
  error?: string;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function launchContext(
  browserProfileDir: string,
  config: AppConfig,
  headless: boolean,
): Promise<BrowserContext> {
  const viewportWidth = randomInt(1280, 1440);
  const viewportHeight = randomInt(800, 900);

  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless,
    viewport: { width: viewportWidth, height: viewportHeight },
    userAgent: undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  };

  if (config.useSystemChrome) {
    launchOptions.channel = "chrome";
  }

  return chromium.launchPersistentContext(browserProfileDir, launchOptions);
}

/**
 * Interactive init flow — opens headed browser for user to log in.
 * Returns when the user has successfully logged in, or on timeout.
 */
export async function initSession(
  browserProfileDir: string,
  config: AppConfig,
): Promise<SessionResult> {
  const context = await launchContext(browserProfileDir, config, false);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    console.log("Please log in to your Google account in the browser window.");
    console.log("Waiting for you to reach the saved places page...");

    // Wait for the URL to indicate we're on the saved places page (not a login redirect)
    // Timeout after 5 minutes to give user time for 2FA
    await page.waitForURL((url) => {
      const href = url.toString();
      return href.includes("/maps/saved") && !href.includes("accounts.google.com");
    }, { timeout: 300_000 });

    // Add a small delay to let cookies fully settle
    await page.waitForTimeout(2000);

    console.log("Login successful! Session saved.");
    return { loggedIn: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, error: message };
  } finally {
    await context.close();
  }
}

/**
 * Health check — verifies the session is still valid by navigating
 * to the saved places page in headless mode.
 * Returns the BrowserContext and Page if logged in (caller must close).
 */
export async function checkSession(
  browserProfileDir: string,
  config: AppConfig,
): Promise<{
  loggedIn: boolean;
  context: BrowserContext | null;
  page: Page | null;
  error?: string;
}> {
  const context = await launchContext(browserProfileDir, config, config.headless);

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    // Wait a moment for any redirects
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const loggedIn =
      currentUrl.includes("/maps/saved") &&
      !currentUrl.includes("accounts.google.com");

    if (loggedIn) {
      return { loggedIn: true, context, page };
    } else {
      await context.close();
      return { loggedIn: false, context: null, page: null };
    }
  } catch (error) {
    await context.close();
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, context: null, page: null, error: message };
  }
}
