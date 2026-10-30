import fs from "fs";
import path from "path";

export function getDataDir(): string | null {
  const custom = process.env.DATA_DIR;
  if (custom) {
    try {
      if (!fs.existsSync(custom)) {
        fs.mkdirSync(custom, { recursive: true });
      }
      return custom;
    } catch {
      // ignore
    }
  }

  try {
    const local = path.join(process.cwd(), "data");
    if (!fs.existsSync(local)) {
      fs.mkdirSync(local, { recursive: true });
    }
    return local;
  } catch {
    return null;
  }
}

export function readStorageFile<T>(filename: string, defaultValue: T): T {
  const dir = getDataDir();
  if (!dir) return defaultValue;
  const filePath = path.join(dir, filename);
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (e) {
    console.error(`[Storage] Failed reading ${filename}:`, e);
    return defaultValue;
  }
}

export function writeStorageFile<T>(filename: string, data: T): boolean {
  const dir = getDataDir();
  if (!dir) return false;
  const filePath = path.join(dir, filename);
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (e) {
    console.error(`[Storage] Failed writing ${filename}:`, e);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    return false;
  }
}
