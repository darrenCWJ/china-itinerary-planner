import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { catalogStatus } from "@/lib/server/catalog";

const LOCK_PATH = path.join(process.cwd(), "data", ".ingest.lock");
const LOG_PATH = path.join(process.cwd(), "data", "ingest.log");
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "ingest-destinations.mjs");
const STALE_LOCK_MS = 30 * 60 * 1000;

function isRefreshRunning(): boolean {
  try {
    const stat = fs.statSync(LOCK_PATH);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
      fs.rmSync(LOCK_PATH, { force: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({ ...catalogStatus(), refreshing: isRefreshRunning() });
}

/** Re-runs the Wikidata/Wikipedia ingestion so the catalog updates itself. */
export async function POST() {
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "The serverless filesystem is read-only — refresh the catalog locally with `node scripts/ingest-destinations.mjs` and redeploy.",
      },
      { status: 501 }
    );
  }
  if (!fs.existsSync(SCRIPT_PATH)) {
    return NextResponse.json({ error: "Ingestion script not found" }, { status: 500 });
  }
  if (isRefreshRunning()) {
    return NextResponse.json({ error: "A refresh is already running" }, { status: 409 });
  }

  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(LOCK_PATH, String(Date.now()));
  const log = fs.openSync(LOG_PATH, "w");
  const cleanup = () => {
    fs.rmSync(LOCK_PATH, { force: true });
    try {
      fs.closeSync(log);
    } catch {
      // Already closed.
    }
  };
  let child;
  try {
    child = spawn(process.execPath, [SCRIPT_PATH], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", log, log],
    });
  } catch {
    cleanup();
    return NextResponse.json({ error: "Could not start the refresh process" }, { status: 500 });
  }
  child.on("exit", cleanup);
  // Without this handler a failed spawn emits an unhandled 'error' event,
  // which Next's global uncaughtException handler turns into a process exit.
  child.on("error", cleanup);
  child.unref();

  return NextResponse.json({ started: true, log: "data/ingest.log" }, { status: 202 });
}
