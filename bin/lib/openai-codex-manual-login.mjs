#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const DEFAULT_MODEL = "openai-codex/gpt-5.4";

const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");
const MAIN_AGENT_DIR = path.join(OPENCLAW_DIR, "agents", "main", "agent");
const SESSION_PATH = path.join("/tmp", "openai-codex-login.json");
const CONFIG_PATH = path.join(OPENCLAW_DIR, "openclaw.json");
const AUTH_STORE_PATH = path.join(MAIN_AGENT_DIR, "auth-profiles.json");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function decodeJwt(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function parseAuthorizationInput(input) {
  const value = String(input || "").trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") || undefined,
      state: url.searchParams.get("state") || undefined,
    };
  } catch {
    // Ignore; fall back to parsing plain strings.
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") || undefined,
      state: params.get("state") || undefined,
    };
  }

  return { code: value };
}

function buildAuthorizeUrl(session) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", session.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", session.state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "pi");
  return url.toString();
}

async function exchangeAuthorizationCode(code, verifier) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error("Token response missing required fields");
  }

  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + (json.expires_in * 1000),
  };
}

function updateAuthStore(credentials) {
  const profileId = "openai-codex:default";
  const store = readJson(AUTH_STORE_PATH, { version: 1, profiles: {} });

  store.version = 1;
  store.profiles = store.profiles && typeof store.profiles === "object" ? store.profiles : {};
  store.profiles[profileId] = {
    type: "oauth",
    provider: "openai-codex",
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires,
    accountId: credentials.accountId,
  };

  writeJson(AUTH_STORE_PATH, store);
  return profileId;
}

function updateConfig(profileId) {
  try {
    fs.accessSync(CONFIG_PATH, fs.constants.W_OK);
  } catch {
    return;
  }

  const config = readJson(CONFIG_PATH, {});
  const next = config && typeof config === "object" ? config : {};

  next.models = next.models && typeof next.models === "object" ? next.models : {};
  if (!next.models.mode) {
    next.models.mode = "merge";
  }

  next.agents = next.agents && typeof next.agents === "object" ? next.agents : {};
  next.agents.defaults = next.agents.defaults && typeof next.agents.defaults === "object" ? next.agents.defaults : {};
  next.agents.defaults.model = next.agents.defaults.model && typeof next.agents.defaults.model === "object"
    ? next.agents.defaults.model
    : {};
  next.agents.defaults.model.primary = DEFAULT_MODEL;

  next.auth = next.auth && typeof next.auth === "object" ? next.auth : {};
  next.auth.profiles = next.auth.profiles && typeof next.auth.profiles === "object" ? next.auth.profiles : {};
  next.auth.profiles[profileId] = {
    provider: "openai-codex",
    mode: "oauth",
  };

  next.auth.order = next.auth.order && typeof next.auth.order === "object" ? next.auth.order : {};
  const currentOrder = Array.isArray(next.auth.order["openai-codex"]) ? next.auth.order["openai-codex"] : [];
  next.auth.order["openai-codex"] = [profileId, ...currentOrder.filter((id) => id !== profileId)];

  next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
  next.meta.lastTouchedAt = new Date().toISOString();
  if (!next.meta.lastTouchedVersion) {
    next.meta.lastTouchedVersion = "2026.3.11";
  }

  writeJson(CONFIG_PATH, next);
}

function startLogin() {
  const { verifier, challenge } = createPkce();
  const session = {
    verifier,
    challenge,
    state: crypto.randomBytes(16).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  writeJson(SESSION_PATH, session);
  console.log(buildAuthorizeUrl(session));
}

async function finishLogin(callbackInput) {
  const session = readJson(SESSION_PATH, null);
  if (!session || !session.verifier || !session.state) {
    throw new Error("No pending OpenAI Codex login session found. Run the start step first.");
  }

  const parsed = parseAuthorizationInput(callbackInput);
  if (!parsed.code) {
    throw new Error("Missing authorization code in callback input");
  }
  if (parsed.state && parsed.state !== session.state) {
    throw new Error("State mismatch");
  }

  const tokens = await exchangeAuthorizationCode(parsed.code, session.verifier);
  const payload = decodeJwt(tokens.access);
  const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  if (!accountId || typeof accountId !== "string") {
    throw new Error("Failed to extract chatgpt_account_id from access token");
  }

  const credentials = {
    ...tokens,
    accountId,
  };
  const profileId = updateAuthStore(credentials);
  updateConfig(profileId);

  try {
    fs.unlinkSync(SESSION_PATH);
  } catch {
    // Ignore cleanup failures.
  }

  console.log(JSON.stringify({
    ok: true,
    profileId,
    defaultModel: DEFAULT_MODEL,
    accountId,
  }, null, 2));
}

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  if (action === "start") {
    startLogin();
    return;
  }
  if (action === "finish") {
    const callbackInput = rest.join(" ").trim();
    if (!callbackInput) {
      throw new Error("Usage: finish <callback-url-or-code>");
    }
    await finishLogin(callbackInput);
    return;
  }
  throw new Error("Usage: start | finish <callback-url-or-code>");
}

main().catch((error) => {
  console.error(String(error && error.message ? error.message : error));
  process.exit(1);
});
