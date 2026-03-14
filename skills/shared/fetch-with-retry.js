#!/usr/bin/env node
/**
 * fetch-with-retry.js - 带自动重试的 HTTP 请求公共模块
 *
 * 功能：
 * - 网络超时/错误时指数退避重试（最多 3 次）
 * - CSRF Token 失效（errorCode: TIANSHU_000030）时自动刷新后重试
 * - Cookie 失效（errorCode: 307）时自动重新登录后重试
 *
 * 用法：
 *   const { fetchWithRetry, loadCookieData, resolveBaseUrl } = require('../../shared/fetch-with-retry');
 */

"use strict";

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ── 项目根目录查找 ────────────────────────────────────────────────────

/**
 * 查找项目根目录（向上查找 README.md 或 .git 目录）
 */
function findProjectRoot() {
  for (const startDir of [process.cwd(), __dirname]) {
    let currentDir = startDir;
    while (currentDir !== path.dirname(currentDir)) {
      if (
        fs.existsSync(path.join(currentDir, "README.md")) ||
        fs.existsSync(path.join(currentDir, ".git"))
      ) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const CONFIG_PATH = path.join(PROJECT_ROOT, "config.json");
const COOKIE_FILE = path.join(PROJECT_ROOT, ".cache", "cookies.json");
const LOGIN_SCRIPT = path.join(
  PROJECT_ROOT,
  ".claude",
  "skills",
  "yida-login",
  "scripts",
  "login.py"
);

const CONFIG = fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"))
  : {};
const DEFAULT_BASE_URL = CONFIG.defaultBaseUrl || "https://www.aliwork.com";

// ── 登录态管理 ────────────────────────────────────────────────────────

/**
 * 从 Cookie 列表中提取 csrf_token 和 corp_id
 */
function extractInfoFromCookies(cookies) {
  let csrfToken = null;
  let corpId = null;
  for (const cookie of cookies) {
    if (cookie.name === "tianshu_csrf_token") {
      csrfToken = cookie.value;
    } else if (cookie.name === "tianshu_corp_user") {
      const lastUnderscore = cookie.value.lastIndexOf("_");
      if (lastUnderscore > 0) {
        corpId = cookie.value.slice(0, lastUnderscore);
      }
    }
  }
  return { csrfToken, corpId };
}

/**
 * 加载本地 Cookie 数据
 */
function loadCookieData() {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  try {
    const raw = fs.readFileSync(COOKIE_FILE, "utf-8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const cookieData = Array.isArray(parsed)
      ? { cookies: parsed, base_url: DEFAULT_BASE_URL }
      : parsed;

    if (cookieData.cookies && cookieData.cookies.length > 0) {
      const { csrfToken, corpId } = extractInfoFromCookies(cookieData.cookies);
      if (csrfToken) cookieData.csrf_token = csrfToken;
      if (corpId) cookieData.corp_id = corpId;
    }
    return cookieData;
  } catch {
    return null;
  }
}

/**
 * 解析 base_url
 */
function resolveBaseUrl(cookieData) {
  return ((cookieData && cookieData.base_url) || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * 登录态失效时退出并提示 agent 调用 yida-login skill。
 *
 * 不再自动调用 login.py，因为在 OpenClaw agent 环境下需要通过
 * yida-login skill 完成扫码登录（browser 工具 + 用户交互）。
 */
function triggerLogin() {
  console.error("\n========================================");
  console.error("❌ 登录态失效，无法继续执行。");
  console.error("");
  console.error("【Agent 必须执行以下操作】");
  console.error("1. 立即调用 yida-login skill");
  console.error("2. yida-login skill 会用 browser 工具打开钉钉扫码页面");
  console.error("3. 截图并通过 message.send 发给用户扫码");
  console.error("4. 用户扫码选择组织后保存 Cookie");
  console.error("5. Cookie 保存成功后重新执行本命令");
  console.error("");
  console.error("⚠️  严禁直接告知用户去自己打开浏览器扫码！");
  console.error("========================================\n");
  process.exit(1);
}

/**
 * CSRF Token 失效时退出并提示 agent 调用 yida-login skill。
 */
function refreshCsrfToken() {
  console.error("\n========================================");
  console.error("❌ csrf_token 已过期，无法继续执行。");
  console.error("");
  console.error("【Agent 必须执行以下操作】");
  console.error("1. 立即调用 yida-login skill");
  console.error("2. yida-login skill 会用 browser 工具打开钉钉扫码页面");
  console.error("3. 截图并通过 message.send 发给用户扫码");
  console.error("4. 用户扫码选择组织后保存 Cookie");
  console.error("5. Cookie 保存成功后重新执行本命令");
  console.error("");
  console.error("⚠️  严禁直接告知用户去自己打开浏览器扫码！");
  console.error("========================================\n");
  process.exit(1);
}

// ── 响应错误类型判断 ──────────────────────────────────────────────────

function isLoginExpired(responseJson) {
  return (
    responseJson &&
    responseJson.success === false &&
    responseJson.errorCode === "307"
  );
}

function isCsrfTokenExpired(responseJson) {
  return (
    responseJson &&
    responseJson.success === false &&
    responseJson.errorCode === "TIANSHU_000030"
  );
}

// ── 核心：带重试的 HTTP 请求 ──────────────────────────────────────────

/**
 * 发送单次 HTTP 请求
 *
 * @param {object} options
 * @param {string} options.url - 完整 URL（如 https://xxx.aliwork.com/query/app/registerApp.json）
 * @param {string} options.method - HTTP 方法（GET/POST）
 * @param {string} [options.body] - 请求体（POST 时使用）
 * @param {object} options.headers - 请求头
 * @param {number} [options.timeout] - 超时毫秒数（默认 30000）
 * @returns {Promise<object>} 解析后的 JSON 响应
 */
function sendRequest({ url, method = "GET", body, headers = {}, timeout = 30_000 }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const requestModule = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
      timeout,
    };

    const request = requestModule.request(requestOptions, (response) => {
      let responseData = "";
      response.on("data", (chunk) => { responseData += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(responseData));
        } catch {
          reject(new Error(`响应非 JSON（HTTP ${response.statusCode}）：${responseData.slice(0, 200)}`));
        }
      });
    });

    request.on("timeout", () => {
      request.destroy();
      reject(new Error("请求超时（ETIMEDOUT）"));
    });

    request.on("error", reject);

    if (body) request.write(body);
    request.end();
  });
}

/**
 * 带自动重试的 HTTP 请求
 *
 * 重试策略：
 * - 网络超时/错误：指数退避重试，最多 maxRetries 次
 * - CSRF Token 失效：刷新 Token 后重试 1 次
 * - Cookie 失效：重新登录后重试 1 次
 *
 * @param {object} requestOptions - 同 sendRequest 的参数
 * @param {object} authContext - 认证上下文，包含 { cookieData, onAuthUpdate }
 * @param {number} [maxRetries=3] - 网络错误最大重试次数
 * @returns {Promise<{ response: object, cookieData: object }>}
 */
async function fetchWithRetry(requestOptions, authContext, maxRetries = 3) {
  let { cookieData } = authContext;
  const { onAuthUpdate } = authContext;

  // 构建 Cookie 头
  function buildCookieHeader(cookies) {
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  // 用当前 cookieData 构建请求头
  function buildHeaders() {
    const baseUrl = resolveBaseUrl(cookieData);
    return {
      ...requestOptions.headers,
      Cookie: buildCookieHeader(cookieData.cookies || []),
      Origin: baseUrl,
      Referer: baseUrl + "/",
    };
  }

  // 网络层重试（指数退避）
  async function sendWithNetworkRetry(opts, attempt = 1) {
    try {
      return await sendRequest(opts);
    } catch (networkError) {
      if (attempt >= maxRetries) {
        throw networkError;
      }
      const waitMs = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
      console.error(
        `  ⚠️  请求失败（${networkError.message}），${waitMs}ms 后重试（${attempt}/${maxRetries}）...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return sendWithNetworkRetry(opts, attempt + 1);
    }
  }

  // 第一次请求
  let response = await sendWithNetworkRetry({
    ...requestOptions,
    headers: buildHeaders(),
  });

  // CSRF Token 失效 → 刷新后重试一次
  if (isCsrfTokenExpired(response)) {
    cookieData = refreshCsrfToken();
    if (onAuthUpdate) onAuthUpdate(cookieData);
    response = await sendWithNetworkRetry({
      ...requestOptions,
      headers: buildHeaders(),
    });
  }

  // Cookie 失效 → 重新登录后重试一次
  if (isLoginExpired(response)) {
    cookieData = triggerLogin();
    if (onAuthUpdate) onAuthUpdate(cookieData);
    response = await sendWithNetworkRetry({
      ...requestOptions,
      headers: buildHeaders(),
    });
  }

  return { response, cookieData };
}

module.exports = {
  fetchWithRetry,
  loadCookieData,
  resolveBaseUrl,
  triggerLogin,
  refreshCsrfToken,
  findProjectRoot,
  PROJECT_ROOT,
  COOKIE_FILE,
  LOGIN_SCRIPT,
  DEFAULT_BASE_URL,
};
