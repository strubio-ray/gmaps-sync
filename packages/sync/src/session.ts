import type { AppConfig } from "@gmaps/core";
import { type BrowserContext, chromium, type Page } from "playwright";

const SAVED_PLACES_URL = "https://www.google.com/maps/@0,0,2z/data=!4m2!10m1!1e1";
const MAS_URL_FRAGMENT = "locationhistory/preview/mas";

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

export async function initSession(
  browserProfileDir: string,
  config: AppConfig,
): Promise<SessionResult> {
  let context: BrowserContext;
  try {
    context = await launchContext(browserProfileDir, config, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, error: `Failed to launch browser: ${message}` };
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const masPromise = page.waitForRequest((req) => req.url().includes(MAS_URL_FRAGMENT), {
      timeout: 300_000,
    });

    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    console.log("Please log in to your Google account in the browser window.");
    console.log("Waiting for you to reach the saved places page...");

    await masPromise;

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

export async function checkSession(
  browserProfileDir: string,
  config: AppConfig,
): Promise<{
  loggedIn: boolean;
  context: BrowserContext | null;
  page: Page | null;
  error?: string;
}> {
  let context: BrowserContext;
  try {
    context = await launchContext(browserProfileDir, config, config.headless);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      loggedIn: false,
      context: null,
      page: null,
      error: `Failed to launch browser: ${message}`,
    };
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const masPromise = page.waitForRequest((req) => req.url().includes(MAS_URL_FRAGMENT), {
      timeout: config.sync.navigationTimeoutMs,
    });

    await page.goto(SAVED_PLACES_URL, {
      waitUntil: "domcontentloaded",
      timeout: config.sync.navigationTimeoutMs,
    });

    try {
      await masPromise;
      return { loggedIn: true, context, page };
    } catch {
      await context.close();
      return { loggedIn: false, context: null, page: null };
    }
  } catch (error) {
    await context.close();
    const message = error instanceof Error ? error.message : String(error);
    return { loggedIn: false, context: null, page: null, error: message };
  }
}

export async function interceptMasResponse(
  page: Page,
  timeoutMs: number,
): Promise<{ masRaw: string | null; sessionToken: string | null }> {
  let masRaw: string | null = null;
  let sessionToken: string | null = null;

  page.on("request", (request) => {
    if (request.url().includes(MAS_URL_FRAGMENT)) {
      const match = request.url().match(/!1s([^!]+)/);
      sessionToken = match ? match[1] : null;
    }
  });

  page.on("response", async (response) => {
    if (response.url().includes(MAS_URL_FRAGMENT) && response.status() === 200) {
      try {
        masRaw = await response.text();
      } catch {
        // Response may not be text
      }
    }
  });

  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });

  const deadline = Date.now() + timeoutMs;
  while (!masRaw && Date.now() < deadline) {
    await page.waitForTimeout(1000);
  }

  return { masRaw, sessionToken };
}
