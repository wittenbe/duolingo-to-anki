import { createHash, createSign } from "crypto";
import { readFileSync } from "fs";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

export interface DriveFileInfo {
  name: string;
  mimeType: string;
  md5Checksum?: string;
  capabilities: { canEdit: boolean };
}

export interface DriveClient {
  getFile(fileId: string): Promise<DriveFileInfo>;
  /** Overwrites the file's content; returns false if it already had exactly this content. */
  updateFileIfChanged(fileId: string, content: string): Promise<boolean>;
}

// Full drive scope: the file was created by the user and only shared with the service account,
// so the narrower drive.file scope wouldn't cover it.
const SCOPE = "https://www.googleapis.com/auth/drive";

const base64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

export function createDriveClient(keyFile: string): DriveClient {
  const key = JSON.parse(readFileSync(keyFile, "utf-8")) as ServiceAccountKey;
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt - 60_000) return token.value;

    const now = Math.floor(Date.now() / 1000);
    const unsigned =
      base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
      "." +
      base64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + 3600 }));
    const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key);

    const res = await fetch(key.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${base64url(signature)}`,
      }),
    });
    if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${await res.text()}`);
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
    return access_token;
  }

  async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) throw new Error(`Google Drive request failed (${res.status}): ${await res.text()}`);
    return res;
  }

  async function getFile(fileId: string): Promise<DriveFileInfo> {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,md5Checksum,capabilities/canEdit`,
    );
    return (await res.json()) as DriveFileInfo;
  }

  async function updateFileIfChanged(fileId: string, content: string): Promise<boolean> {
    const md5 = createHash("md5").update(content, "utf-8").digest("hex");
    if ((await getFile(fileId)).md5Checksum === md5) return false;

    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: content,
    });
    return true;
  }

  return { getFile, updateFileIfChanged };
}
