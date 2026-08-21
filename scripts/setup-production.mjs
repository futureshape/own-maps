#!/usr/bin/env node
/* global fetch */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WRANGLER = path.join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);
const WRANGLER_CONFIG = path.join(ROOT, "wrangler.jsonc");

const GOOGLE_BROWSER_SERVICES = [
  "maps-backend.googleapis.com",
  "places-backend.googleapis.com",
  "places.googleapis.com",
  "placewidgets.googleapis.com",
];
const GOOGLE_SERVICES = [
  "apikeys.googleapis.com",
  "mapmanagement.googleapis.com",
  ...GOOGLE_BROWSER_SERVICES,
  "static-maps-backend.googleapis.com",
];
const LOCAL_ORIGINS = ["http://localhost:8787", "http://127.0.0.1:8787"];

class CommandError extends Error {
  constructor(command, args, code, output) {
    super(`${command} ${args.join(" ")} exited with status ${code}${output ? `\n${output.trim()}` : ""}`);
    this.name = "CommandError";
    this.code = code;
  }
}

function print(message = "") {
  process.stdout.write(`${message}\n`);
}

function heading(message) {
  print(`\n==> ${message}`);
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

async function run(command, args, options = {}) {
  const {
    allowFailure = false,
    capture = false,
    env = {},
    input,
    tee = false,
  } = options;

  return await new Promise((resolve, reject) => {
    const pipeOutput = capture || tee;
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: [input === undefined ? "inherit" : "pipe", pipeOutput ? "pipe" : "inherit", pipeOutput ? "pipe" : "inherit"],
    });
    let stdout = "";
    let stderr = "";

    if (pipeOutput) {
      child.stdout.on("data", (chunk) => {
        const value = chunk.toString();
        stdout += value;
        if (tee) process.stdout.write(value);
      });
      child.stderr.on("data", (chunk) => {
        const value = chunk.toString();
        stderr += value;
        if (tee) process.stderr.write(value);
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` };
      if (result.code !== 0 && !allowFailure) {
        reject(new CommandError(command, args, result.code, result.output));
        return;
      }
      resolve(result);
    });

    if (input !== undefined) child.stdin.end(`${input}\n`);
  });
}

async function ask(prompt, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await readline.question(`${prompt}${suffix}: `)).trim();
    return answer || defaultValue;
  } finally {
    readline.close();
  }
}

async function confirm(prompt, defaultValue = false) {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (await ask(`${prompt} (${hint})`)).toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function askSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return await ask(prompt);
  }

  return await new Promise((resolve, reject) => {
    let value = "";
    const previousRawMode = process.stdin.isRaw;
    process.stdout.write(`${prompt}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(Boolean(previousRawMode));
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };

    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

async function selectOne(prompt, choices, label) {
  if (choices.length === 0) throw new Error(`No choices are available for ${prompt.toLowerCase()}.`);
  if (choices.length === 1) {
    print(`${prompt}: ${label(choices[0])}`);
    return choices[0];
  }

  print(prompt);
  choices.forEach((choice, index) => print(`  ${index + 1}. ${label(choice)}`));
  while (true) {
    const answer = await ask("Choose a number", "1");
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isInteger(index) && choices[index]) return choices[index];
    print("Please enter one of the listed numbers.");
  }
}

function stripJsonComments(source) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    result += character;
  }

  return result.replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonc(source) {
  return JSON.parse(stripJsonComments(source));
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`Unsupported production origin: ${value}`);
  return url.origin;
}

export function originReferrers(origins) {
  return [...new Set(origins.flatMap((origin) => {
    const normalized = normalizeOrigin(origin);
    return [normalized, `${normalized}/*`];
  }))];
}

export function parseWorkerOrigin(output) {
  const matches = output.match(/https:\/\/[^\s)\]]+/g) ?? [];
  const candidates = matches
    .map((value) => value.replace(/[.,;]+$/, ""))
    .filter((value) => !value.includes("developers.cloudflare.com") && !value.includes("api.cloudflare.com"));
  const preferred = candidates.find((value) => value.includes(".workers.dev")) ?? candidates[0];
  return preferred ? normalizeOrigin(preferred) : undefined;
}

function formatEnvFile(source, values) {
  const remaining = new Map(Object.entries(values));
  const lines = source ? source.replace(/\n$/, "").split("\n") : [];
  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${JSON.stringify(value)}`;
  });

  if (updated.length > 0 && remaining.size > 0 && updated.at(-1) !== "") updated.push("");
  for (const [key, value] of remaining) updated.push(`${key}=${JSON.stringify(value)}`);
  return `${updated.join("\n")}\n`;
}

async function updateEnvFile(filename, values) {
  const target = path.join(ROOT, filename);
  const current = existsSync(target) ? await readFile(target, "utf8") : "";
  await writeFile(target, formatEnvFile(current, values), { mode: 0o600 });
  await chmod(target, 0o600);
}

function parseJsonOutput(result, description) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Could not parse ${description} output as JSON.`);
  }
}

async function retry(description, operation, attempts = 8) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      print(`${description} is not ready yet; retrying in 5 seconds (${attempt}/${attempts})...`);
      await delay(5_000);
    }
  }
  throw lastError;
}

async function ensureGoogleLogin() {
  const status = await run("gcloud", ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], {
    capture: true,
    allowFailure: true,
  });
  if (!status.stdout.trim()) {
    print("Opening Google sign-in...");
    await run("gcloud", ["auth", "login"]);
  }
}

async function chooseGoogleProject() {
  const result = await run("gcloud", ["projects", "list", "--filter=lifecycleState:ACTIVE", "--format=json"], { capture: true });
  const projects = parseJsonOutput(result, "Google project list");
  const project = await selectOne(
    "Select the billing-enabled Google Cloud project",
    projects,
    (item) => `${item.name || item.projectId} (${item.projectId})`,
  );
  const billingResult = await run("gcloud", ["billing", "projects", "describe", project.projectId, "--format=json"], {
    capture: true,
    allowFailure: true,
  });
  if (billingResult.code !== 0) {
    throw new Error(`Could not verify billing for ${project.projectId}. Make sure you can view billing on that project.`);
  }
  const billing = parseJsonOutput(billingResult, "Google billing status");
  if (!billing.billingEnabled) {
    throw new Error(`Google Cloud billing is not enabled for ${project.projectId}. Enable it and run this command again.`);
  }
  return project;
}

async function ensureCloudflareLogin() {
  let status = await run(WRANGLER, ["whoami", "--json"], { capture: true, allowFailure: true });
  if (status.code !== 0) {
    print("Opening Cloudflare sign-in...");
    await run(WRANGLER, ["login", "--use-keyring"]);
    status = await run(WRANGLER, ["whoami", "--json"], { capture: true });
  }
  return parseJsonOutput(status, "Cloudflare account");
}

function cloudflareAccounts(identity) {
  if (Array.isArray(identity.accounts) && identity.accounts.length > 0) return identity.accounts;
  if (identity.accountId) return [{ accountId: identity.accountId, accountName: identity.accountName || identity.accountId }];
  return [];
}

async function ensureGitHubLogin() {
  const status = await run("gh", ["auth", "status"], { capture: true, allowFailure: true });
  if (status.code !== 0) {
    print("Opening GitHub sign-in...");
    await run("gh", ["auth", "login", "--web", "--git-protocol", "https"]);
  }
}

async function googleAccessToken() {
  const result = await run("gcloud", ["auth", "print-access-token"], { capture: true });
  return result.stdout.trim();
}

async function googleApi(project, pathname, options = {}) {
  const token = await googleAccessToken();
  const response = await fetch(`https://mapmanagement.googleapis.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Goog-User-Project": project.projectNumber || project.projectId,
      ...options.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Google Map Management API returned ${response.status}: ${body}`);
  return body ? JSON.parse(body) : {};
}

async function ensureMapId(project, displayName) {
  const parent = `/v2/projects/${encodeURIComponent(project.projectNumber || project.projectId)}/mapConfigs`;
  const listing = await retry("Google Map Management API", () => googleApi(project, parent));
  const existing = (listing.mapConfigs ?? []).find((item) => item.displayName === displayName);
  if (existing?.mapId) return existing.mapId;

  const created = await googleApi(project, parent, {
    method: "POST",
    body: JSON.stringify({
      displayName,
      description: "Provisioned by the Pinboard Maps setup-production script",
      mapType: "VECTOR",
    }),
  });
  if (!created.mapId) throw new Error("Google created a map configuration but did not return its map ID.");
  return created.mapId;
}

async function listGoogleApiKeys(projectId) {
  const result = await run("gcloud", ["services", "api-keys", "list", `--project=${projectId}`, "--format=json"], { capture: true });
  return parseJsonOutput(result, "Google API key list");
}

async function ensureGoogleApiKey({ displayName, projectId, services, referrers }) {
  let keys = await listGoogleApiKeys(projectId);
  let key = keys.find((item) => item.displayName === displayName);

  if (!key) {
    await retry("Google API Keys API", () => run("gcloud", [
      "services",
      "api-keys",
      "create",
      `--project=${projectId}`,
      `--display-name=${displayName}`,
      `--key-id=pinboard-${createHash("sha256").update(displayName).digest("hex").slice(0, 16)}`,
      ...services.map((service) => `--api-target=service=${service}`),
      ...(referrers ? [`--allowed-referrers=${referrers.join(",")}`] : []),
      "--quiet",
    ], { capture: true }));
    keys = await listGoogleApiKeys(projectId);
    key = keys.find((item) => item.displayName === displayName);
  }

  if (!key?.name) throw new Error(`Could not find the Google API key named ${displayName} after creating it.`);
  const keyName = key.name.includes("/") ? key.name : `projects/${projectId}/locations/global/keys/${key.name}`;
  await run("gcloud", [
    "services",
    "api-keys",
    "update",
    keyName,
    ...services.map((service) => `--api-target=service=${service}`),
    ...(referrers ? [`--allowed-referrers=${referrers.join(",")}`] : []),
    "--quiet",
  ], { capture: true });

  const secret = await run("gcloud", [
    "services",
    "api-keys",
    "get-key-string",
    keyName,
    "--format=value(keyString)",
  ], { capture: true });
  const keyString = secret.stdout.trim();
  if (!keyString) throw new Error(`Google did not return the key string for ${displayName}.`);
  return { name: keyName, keyString };
}

async function updateBrowserKey(keyName, referrers) {
  await run("gcloud", [
    "services",
    "api-keys",
    "update",
    keyName,
    ...GOOGLE_BROWSER_SERVICES.map((service) => `--api-target=service=${service}`),
    `--allowed-referrers=${referrers.join(",")}`,
    "--quiet",
  ], { capture: true });
}

async function writeWranglerConfig(config) {
  await writeFile(WRANGLER_CONFIG, `${JSON.stringify(config, null, 2)}\n`);
}

function d1Databases(value) {
  if (Array.isArray(value)) return value;
  return value?.d1_databases ?? value?.databases ?? [];
}

async function ensureD1(config, workerName, cloudflareEnv) {
  let result = await run(WRANGLER, ["d1", "list", "--json"], { capture: true, env: cloudflareEnv });
  let databases = d1Databases(parseJsonOutput(result, "Cloudflare D1 list"));
  const configuredId = config.d1_databases?.find((item) => item.binding === "DB")?.database_id;
  const databaseName = `${workerName}-prod`;
  let database = databases.find((item) => item.uuid === configuredId || item.id === configuredId);
  database ??= databases.find((item) => item.name === databaseName);

  if (!database) {
    print(`Creating D1 database ${databaseName}...`);
    await run(WRANGLER, ["d1", "create", databaseName], { env: cloudflareEnv });
    result = await run(WRANGLER, ["d1", "list", "--json"], { capture: true, env: cloudflareEnv });
    databases = d1Databases(parseJsonOutput(result, "Cloudflare D1 list"));
    database = databases.find((item) => item.name === databaseName);
  }

  const databaseId = database?.uuid ?? database?.id;
  if (!databaseId) throw new Error(`Could not resolve the ID of D1 database ${databaseName}.`);
  config.d1_databases = [{
    binding: "DB",
    database_name: database.name ?? databaseName,
    database_id: databaseId,
    migrations_dir: "migrations",
  }];
  return config;
}

async function detectGitHubRepository() {
  const result = await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    capture: true,
    allowFailure: true,
  });
  return result.code === 0 ? result.stdout.trim() : "";
}

async function setGitHubSecret(repository, name, value) {
  await run("gh", ["secret", "set", name, "--repo", repository], { input: value, capture: true });
}

async function hasGitHubSecret(repository, name) {
  const result = await run("gh", ["secret", "list", "--repo", repository, "--json", "name"], { capture: true });
  return parseJsonOutput(result, "GitHub secret list").some((item) => item.name === name);
}

async function configureGitHub(repository, values, cloudflareAccountId) {
  heading(`Uploading GitHub Actions configuration to ${repository}`);
  await setGitHubSecret(repository, "VITE_GOOGLE_MAPS_API_KEY", values.browserKey);
  await setGitHubSecret(repository, "VITE_GOOGLE_MAP_ID", values.mapId);
  await setGitHubSecret(repository, "VITE_GOOGLE_CLIENT_ID", values.clientId);
  await setGitHubSecret(repository, "CLOUDFLARE_ACCOUNT_ID", cloudflareAccountId);

  let apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
  const tokenAlreadyStored = await hasGitHubSecret(repository, "CLOUDFLARE_API_TOKEN");
  if (!apiToken && !tokenAlreadyStored && await confirm("Enable automatic production deployments from GitHub Actions now?", false)) {
    print("Create a narrow Cloudflare API token with Workers Scripts edit, D1 edit, and account read permissions:");
    print("https://dash.cloudflare.com/profile/api-tokens");
    apiToken = await askSecret("Paste the Cloudflare API token (input is hidden)");
  }

  if (apiToken) {
    const tokenCheck = await run(WRANGLER, ["whoami", "--json"], {
      capture: true,
      allowFailure: true,
      env: { CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId, CLOUDFLARE_API_TOKEN: apiToken },
    });
    if (tokenCheck.code !== 0) throw new Error("Cloudflare rejected the API token; no GitHub deployment credential was uploaded.");
    await setGitHubSecret(repository, "CLOUDFLARE_API_TOKEN", apiToken);
    await run("gh", ["variable", "set", "CLOUDFLARE_DEPLOY_ENABLED", "--body", "true", "--repo", repository], { capture: true });
    return true;
  }

  if (tokenAlreadyStored) {
    await run("gh", ["variable", "set", "CLOUDFLARE_DEPLOY_ENABLED", "--body", "true", "--repo", repository], { capture: true });
    return true;
  }

  await run("gh", ["variable", "set", "CLOUDFLARE_DEPLOY_ENABLED", "--body", "false", "--repo", repository], { capture: true });
  return false;
}

function validateWorkerName(value) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error("The Worker name must use lowercase letters, numbers, or hyphens and cannot start or end with a hyphen.");
  }
  return value;
}

function parseArguments(argv) {
  const options = { skipGitHub: false, yes: false, productionOrigin: process.env.OWN_MAPS_PRODUCTION_ORIGIN || "" };
  for (const argument of argv) {
    if (argument === "--skip-github") options.skipGitHub = true;
    else if (argument === "--yes") options.yes = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--production-origin=")) options.productionOrigin = argument.slice("--production-origin=".length);
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

function showHelp() {
  print(`Usage: npm run setup-production -- [options]

Provision Google Maps credentials, Cloudflare D1 and Worker resources, local
configuration, and GitHub Actions secrets for a new production installation.

Options:
  --production-origin=https://maps.example.com
                           Configure and authorize a Cloudflare custom domain
  --skip-github            Do not authenticate with or configure GitHub
  --yes                    Skip the initial provisioning confirmation
  -h, --help               Show this help

The command is rerunnable: it reuses resources with the same generated names.`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }

  heading("Pinboard Maps production setup");
  print("This command creates or updates billable Google Maps and Cloudflare resources, writes ignored local env files, and deploys the Worker.");
  if (!options.yes && !await confirm("Continue?", false)) return;

  const missing = [];
  if (!commandAvailable("gcloud")) missing.push("Google Cloud CLI (gcloud): https://cloud.google.com/sdk/docs/install");
  if (!options.skipGitHub && !commandAvailable("gh")) missing.push("GitHub CLI (gh): https://cli.github.com/");
  if (!commandAvailable("git")) missing.push("Git");
  if (!existsSync(WRANGLER)) missing.push("project dependencies (run npm ci first)");
  if (missing.length > 0) throw new Error(`Install these prerequisites, then rerun the command:\n- ${missing.join("\n- ")}`);

  heading("Signing in");
  await ensureGoogleLogin();
  const project = await chooseGoogleProject();
  const cloudflareIdentity = await ensureCloudflareLogin();
  const cloudflareAccount = await selectOne(
    "Select the Cloudflare account",
    cloudflareAccounts(cloudflareIdentity),
    (item) => `${item.accountName || item.name || "Cloudflare account"} (${item.accountId || item.id})`,
  );
  const cloudflareAccountId = cloudflareAccount.accountId || cloudflareAccount.id;
  const cloudflareEnv = { CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId };
  if (!options.skipGitHub) await ensureGitHubLogin();

  const config = parseJsonc(await readFile(WRANGLER_CONFIG, "utf8"));
  const workerName = validateWorkerName(await ask("Cloudflare Worker name", config.name || "own-maps"));
  config.name = workerName;
  config.account_id = cloudflareAccountId;
  if (options.productionOrigin) {
    const customOrigin = new URL(normalizeOrigin(options.productionOrigin));
    if (customOrigin.protocol !== "https:" || customOrigin.port) {
      throw new Error("A Cloudflare custom production origin must use HTTPS and cannot include a port.");
    }
    config.routes = [
      ...(config.routes ?? []).filter((route) => !route.custom_domain),
      { pattern: customOrigin.hostname, custom_domain: true },
    ];
  }

  heading(`Provisioning Google Maps in ${project.projectId}`);
  print("Enabling the required Google APIs...");
  await run("gcloud", ["services", "enable", ...GOOGLE_SERVICES, `--project=${project.projectId}`, "--quiet"]);

  const resourcePrefix = `${workerName} production`;
  const initialReferrers = originReferrers([
    ...LOCAL_ORIGINS,
    ...(options.productionOrigin ? [normalizeOrigin(options.productionOrigin)] : []),
  ]);
  const mapId = await ensureMapId(project, `${resourcePrefix} map`);
  const browserKey = await ensureGoogleApiKey({
    displayName: `${resourcePrefix} browser`,
    projectId: project.projectId,
    services: GOOGLE_BROWSER_SERVICES,
    referrers: initialReferrers,
  });
  const staticKey = await ensureGoogleApiKey({
    displayName: `${resourcePrefix} static previews`,
    projectId: project.projectId,
    services: ["static-maps-backend.googleapis.com"],
  });

  heading("One manual Google OAuth action");
  print("Open the Google Auth Platform client page:");
  print(`https://console.cloud.google.com/auth/clients?project=${encodeURIComponent(project.projectId)}`);
  print("Create a Web application client and add http://localhost:8787 under Authorized JavaScript origins.");
  print("No redirect URI is required. If Google asks, configure the consent screen for openid, email, and profile only.");
  let clientId = await ask("Paste the OAuth web client ID");
  while (!clientId.endsWith(".apps.googleusercontent.com")) {
    print("That does not look like a Google OAuth web client ID.");
    clientId = await ask("Paste the OAuth web client ID");
  }

  heading("Preparing Cloudflare");
  await ensureD1(config, workerName, cloudflareEnv);
  await writeWranglerConfig(config);
  await updateEnvFile(".env", {
    VITE_GOOGLE_MAPS_API_KEY: browserKey.keyString,
    VITE_GOOGLE_MAP_ID: mapId,
    VITE_GOOGLE_CLIENT_ID: clientId,
  });
  await updateEnvFile(".dev.vars", {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_MAPS_STATIC_API_KEY: staticKey.keyString,
    APP_ENV: "development",
  });

  print("Applying production D1 migrations...");
  await run(WRANGLER, ["d1", "migrations", "apply", "DB", "--remote"], { env: cloudflareEnv });
  print("Building the application...");
  const buildEnv = {
    VITE_GOOGLE_MAPS_API_KEY: browserKey.keyString,
    VITE_GOOGLE_MAP_ID: mapId,
    VITE_GOOGLE_CLIENT_ID: clientId,
  };
  await run("npm", ["run", "build"], { env: buildEnv });

  const secretDirectory = await mkdtemp(path.join(tmpdir(), "own-maps-production-"));
  const secretFile = path.join(secretDirectory, "worker-secrets.json");
  await writeFile(secretFile, JSON.stringify({
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_MAPS_STATIC_API_KEY: staticKey.keyString,
  }), { mode: 0o600 });

  let deployResult;
  try {
    print("Deploying the Worker and static assets...");
    deployResult = await run(WRANGLER, ["deploy", "--secrets-file", secretFile], {
      env: { ...cloudflareEnv, ...buildEnv },
      tee: true,
    });
  } finally {
    if (existsSync(secretFile)) await unlink(secretFile);
    if (existsSync(secretDirectory)) await rmdir(secretDirectory);
  }

  let productionOrigin = options.productionOrigin ? normalizeOrigin(options.productionOrigin) : parseWorkerOrigin(deployResult.output);
  if (!productionOrigin) productionOrigin = normalizeOrigin(await ask("Production origin shown by Cloudflare (for example, https://my-worker.example.workers.dev)"));
  await updateBrowserKey(browserKey.name, originReferrers([...LOCAL_ORIGINS, productionOrigin]));

  heading("Final Google OAuth origin");
  print(`Add this exact Authorized JavaScript origin to the OAuth web client: ${productionOrigin}`);
  print(`https://console.cloud.google.com/auth/clients?project=${encodeURIComponent(project.projectId)}`);
  await ask("Press Enter after saving the origin in Google Cloud");

  let githubConfigured = false;
  let githubDeployEnabled = false;
  if (!options.skipGitHub) {
    let repository = await detectGitHubRepository();
    if (repository && !await confirm(`Upload Actions secrets to ${repository}?`, true)) repository = "";
    if (!repository) repository = await ask("GitHub repository (owner/name), or leave blank to skip");
    if (repository) {
      githubDeployEnabled = await configureGitHub(repository, { browserKey: browserKey.keyString, mapId, clientId }, cloudflareAccountId);
      githubConfigured = true;
    }
  }

  heading("Production setup complete");
  print(`Application: ${productionOrigin}`);
  print(`Google project: ${project.projectId}`);
  print(`Cloudflare Worker: ${workerName}`);
  print("Local .env and .dev.vars were updated; both remain ignored by Git.");
  print("wrangler.jsonc now contains this installation's non-secret Cloudflare account and D1 IDs; commit that file.");
  if (githubConfigured && githubDeployEnabled) print("GitHub Actions production deployments are enabled.");
  else if (githubConfigured) print("GitHub validation is configured. Production deployment remains disabled until a CLOUDFLARE_API_TOKEN is uploaded and CLOUDFLARE_DEPLOY_ENABLED is set to true.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`\nSetup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
