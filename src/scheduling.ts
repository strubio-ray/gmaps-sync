import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const PLIST_NAME = "com.gmaps-sync.pull";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generatePlist(profile: string): string {
  const logDir = join(homedir(), ".gmaps-sync", "logs");
  const binPath = process.argv[1];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>node</string>
        <string>${binPath}</string>
        <string>pull</string>
        <string>--profile</string>
        <string>${xmlEscape(profile)}</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${logDir}/pull-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/pull-stderr.log</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;
}

export function installSchedule(profile: string): void {
  const logDir = join(homedir(), ".gmaps-sync", "logs");
  mkdirSync(logDir, { recursive: true });

  const plistContent = generatePlist(profile);
  writeFileSync(PLIST_PATH, plistContent);

  try {
    execFileSync("launchctl", ["load", PLIST_PATH]);
    console.log(`Schedule installed: ${PLIST_PATH}`);
    console.log("Pull will run daily at 6:00 AM (with jitter).");
  } catch (error) {
    console.error("Failed to load plist:", error);
  }
}

export function uninstallSchedule(): void {
  if (!existsSync(PLIST_PATH)) {
    console.log("No schedule installed.");
    return;
  }

  try {
    execFileSync("launchctl", ["unload", PLIST_PATH]);
  } catch {
    // May already be unloaded
  }

  unlinkSync(PLIST_PATH);
  console.log("Schedule removed.");
}
