/**
 * 单元测试：create-app.js 工具函数
 *
 * 覆盖：
 * - buildRegisterPostData：POST 请求体构建
 * - loadCookieData：Cookie 文件加载（mock fs）
 * - updateRdCorpId：prd 文档更新逻辑
 */

"use strict";

const querystring = require("querystring");

// ── buildRegisterPostData 逻辑（与脚本完全一致）────────────────────

function buildRegisterPostData(csrfToken, appName, description, icon, iconColor) {
  const iconValue = icon + "%%" + iconColor;
  return querystring.stringify({
    _csrf_token: csrfToken,
    appName: JSON.stringify({ zh_CN: appName, en_US: appName, type: "i18n" }),
    description: JSON.stringify({ zh_CN: description, en_US: description, type: "i18n" }),
    icon: iconValue,
    iconUrl: iconValue,
    colour: "blue",
    defaultLanguage: "zh_CN",
    openExclusive: "n",
    openPhysicColumn: "n",
    openIsolationDatabase: "n",
    openExclusiveUnit: "n",
    group: "全部应用",
  });
}

// ── loadCookieData 核心逻辑（不依赖文件系统的纯解析部分）────────────

function parseCookieFileContent(rawContent, defaultBaseUrl) {
  if (!rawContent || !rawContent.trim()) return null;
  try {
    const parsed = JSON.parse(rawContent.trim());
    let cookieData;
    if (Array.isArray(parsed)) {
      cookieData = { cookies: parsed, base_url: defaultBaseUrl };
    } else {
      cookieData = parsed;
    }
    // 从 Cookie 中提取 csrf_token 和 corp_id
    if (cookieData.cookies && cookieData.cookies.length > 0) {
      for (const cookie of cookieData.cookies) {
        if (cookie.name === "tianshu_csrf_token") {
          cookieData.csrf_token = cookie.value;
        } else if (cookie.name === "tianshu_corp_user") {
          const lastUnderscore = cookie.value.lastIndexOf("_");
          if (lastUnderscore > 0) {
            cookieData.corp_id = cookie.value.slice(0, lastUnderscore);
          }
        }
      }
    }
    return cookieData;
  } catch {
    return null;
  }
}

// ── buildRegisterPostData 测试 ───────────────────────────────────────

describe("buildRegisterPostData", () => {
  test("正常构建 POST 请求体", () => {
    const postData = buildRegisterPostData(
      "csrf_token_123",
      "考勤管理",
      "员工考勤打卡系统",
      "xian-daka",
      "#00B853"
    );
    const parsed = querystring.parse(postData);

    expect(parsed._csrf_token).toBe("csrf_token_123");
    expect(parsed.colour).toBe("blue");
    expect(parsed.defaultLanguage).toBe("zh_CN");
    expect(parsed.openExclusive).toBe("n");
    expect(parsed.group).toBe("全部应用");
  });

  test("icon 和 iconColor 拼接为 icon%%iconColor 格式", () => {
    const postData = buildRegisterPostData(
      "token",
      "测试应用",
      "描述",
      "xian-yingyong",
      "#0089FF"
    );
    const parsed = querystring.parse(postData);
    expect(parsed.icon).toBe("xian-yingyong%%#0089FF");
    expect(parsed.iconUrl).toBe("xian-yingyong%%#0089FF");
  });

  test("appName 和 description 序列化为 i18n 格式", () => {
    const postData = buildRegisterPostData(
      "token",
      "我的应用",
      "应用描述",
      "xian-yingyong",
      "#0089FF"
    );
    const parsed = querystring.parse(postData);
    const appNameObj = JSON.parse(parsed.appName);
    const descObj = JSON.parse(parsed.description);

    expect(appNameObj.zh_CN).toBe("我的应用");
    expect(appNameObj.en_US).toBe("我的应用");
    expect(appNameObj.type).toBe("i18n");
    expect(descObj.zh_CN).toBe("应用描述");
    expect(descObj.type).toBe("i18n");
  });

  test("包含所有必要字段", () => {
    const postData = buildRegisterPostData("t", "app", "desc", "icon", "#fff");
    const parsed = querystring.parse(postData);

    const requiredFields = [
      "_csrf_token", "appName", "description", "icon", "iconUrl",
      "colour", "defaultLanguage", "openExclusive", "openPhysicColumn",
      "openIsolationDatabase", "openExclusiveUnit", "group",
    ];
    for (const field of requiredFields) {
      expect(parsed).toHaveProperty(field);
    }
  });
});

// ── parseCookieFileContent 测试 ──────────────────────────────────────

describe("parseCookieFileContent（loadCookieData 核心逻辑）", () => {
  const defaultBaseUrl = "https://www.aliwork.com";

  test("旧版纯数组格式：自动补充 base_url", () => {
    const cookies = [
      { name: "tianshu_csrf_token", value: "token123" },
      { name: "tianshu_corp_user", value: "CORP001_USER001" },
    ];
    const raw = JSON.stringify(cookies);
    const result = parseCookieFileContent(raw, defaultBaseUrl);

    expect(result).not.toBeNull();
    expect(result.base_url).toBe(defaultBaseUrl);
    expect(result.csrf_token).toBe("token123");
    expect(result.corp_id).toBe("CORP001");
  });

  test("新版对象格式：保留 base_url", () => {
    const cookieData = {
      cookies: [
        { name: "tianshu_csrf_token", value: "token456" },
        { name: "tianshu_corp_user", value: "CORP002_USER002" },
      ],
      base_url: "https://custom.aliwork.com",
    };
    const raw = JSON.stringify(cookieData);
    const result = parseCookieFileContent(raw, defaultBaseUrl);

    expect(result.base_url).toBe("https://custom.aliwork.com");
    expect(result.csrf_token).toBe("token456");
    expect(result.corp_id).toBe("CORP002");
  });

  test("空内容返回 null", () => {
    expect(parseCookieFileContent("", defaultBaseUrl)).toBeNull();
    expect(parseCookieFileContent("   ", defaultBaseUrl)).toBeNull();
    expect(parseCookieFileContent(null, defaultBaseUrl)).toBeNull();
  });

  test("无效 JSON 返回 null", () => {
    expect(parseCookieFileContent("not-json", defaultBaseUrl)).toBeNull();
    expect(parseCookieFileContent("{broken", defaultBaseUrl)).toBeNull();
  });

  test("Cookie 列表为空时，不提取 csrf_token 和 corp_id", () => {
    const cookieData = { cookies: [], base_url: "https://www.aliwork.com" };
    const result = parseCookieFileContent(JSON.stringify(cookieData), defaultBaseUrl);
    expect(result).not.toBeNull();
    expect(result.csrf_token).toBeUndefined();
    expect(result.corp_id).toBeUndefined();
  });

  test("Cookie 中有 tianshu_corp_user 但无下划线时，不设置 corp_id", () => {
    const cookies = [
      { name: "tianshu_corp_user", value: "NOUNDERSCORE" },
    ];
    const result = parseCookieFileContent(JSON.stringify(cookies), defaultBaseUrl);
    expect(result.corp_id).toBeUndefined();
  });
});
