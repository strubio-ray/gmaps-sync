import { execSync } from "node:child_process";

function notify(title: string, message: string): void {
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedMessage = message.replace(/"/g, '\\"');
  try {
    execSync(
      `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`,
    );
  } catch {
    // osascript may not be available on non-macOS systems — fail silently
    console.warn(`[notifications] Could not send notification: ${title}`);
  }
}

export function notifySessionExpired(profile: string): void {
  notify(
    "gmaps-sync: Session Expired",
    `Profile "${profile}" needs re-authentication. Run: gmaps-sync init --profile ${profile}`,
  );
}

export function notifySchemaFailure(): void {
  notify(
    "gmaps-sync: Schema Failure",
    "All lists failed to parse. Schema may be outdated — check snapshots/ for raw responses.",
  );
}

export function notifySyncComplete(
  profile: string,
  added: number,
  updated: number,
): void {
  notify(
    "gmaps-sync: Sync Complete",
    `Profile "${profile}": ${added} added, ${updated} updated.`,
  );
}
