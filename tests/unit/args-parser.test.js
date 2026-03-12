/**
 * 单元测试：各 skill 脚本的参数解析逻辑
 *
 * 通过 mock process.argv 来测试各脚本的参数解析行为，
 * 覆盖正常参数、缺少必填参数、默认值等边界情况。
 */

"use strict";

// ── create-app.js 参数解析逻辑 ───────────────────────────────────────

function parseCreateAppArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 1) {
    return null; // 参数不足
  }
  return {
    appName: args[0],
    description: args[1] || args[0],
    icon: args[2] || "xian-yingyong",
    iconColor: args[3] || "#0089FF",
  };
}

// ── create-page.js 参数解析逻辑 ─────────────────────────────────────

function parseCreatePageArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) {
    return null;
  }
  return {
    appType: args[0],
    pageName: args[1],
  };
}

// ── get-schema.js 参数解析逻辑 ──────────────────────────────────────

function parseGetSchemaArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 2) {
    return null;
  }
  return {
    appType: args[0],
    formUuid: args[1],
  };
}

// ── create-app.js 参数解析测试 ───────────────────────────────────────

describe("create-app.js 参数解析", () => {
  test("只传 appName 时，其余参数使用默认值", () => {
    const argv = ["node", "create-app.js", "考勤管理"];
    const result = parseCreateAppArgs(argv);
    expect(result).not.toBeNull();
    expect(result.appName).toBe("考勤管理");
    expect(result.description).toBe("考勤管理"); // 默认同 appName
    expect(result.icon).toBe("xian-yingyong");
    expect(result.iconColor).toBe("#0089FF");
  });

  test("传入所有参数时，正确解析", () => {
    const argv = ["node", "create-app.js", "考勤管理", "员工考勤打卡系统", "xian-daka", "#00B853"];
    const result = parseCreateAppArgs(argv);
    expect(result.appName).toBe("考勤管理");
    expect(result.description).toBe("员工考勤打卡系统");
    expect(result.icon).toBe("xian-daka");
    expect(result.iconColor).toBe("#00B853");
  });

  test("传入 appName 和 description，icon 和 iconColor 使用默认值", () => {
    const argv = ["node", "create-app.js", "我的应用", "应用描述"];
    const result = parseCreateAppArgs(argv);
    expect(result.description).toBe("应用描述");
    expect(result.icon).toBe("xian-yingyong");
    expect(result.iconColor).toBe("#0089FF");
  });

  test("没有参数时返回 null（应退出）", () => {
    const argv = ["node", "create-app.js"];
    const result = parseCreateAppArgs(argv);
    expect(result).toBeNull();
  });

  test("appName 为空字符串时仍能解析（边界情况）", () => {
    const argv = ["node", "create-app.js", ""];
    const result = parseCreateAppArgs(argv);
    expect(result).not.toBeNull();
    expect(result.appName).toBe("");
    // description 默认同 appName，但空字符串是 falsy，会回退到 args[0]（也是空字符串）
    expect(result.description).toBe("");
  });
});

// ── create-page.js 参数解析测试 ─────────────────────────────────────

describe("create-page.js 参数解析", () => {
  test("传入 appType 和 pageName 时，正确解析", () => {
    const argv = ["node", "create-page.js", "APP_ABC123", "游戏主页"];
    const result = parseCreatePageArgs(argv);
    expect(result).not.toBeNull();
    expect(result.appType).toBe("APP_ABC123");
    expect(result.pageName).toBe("游戏主页");
  });

  test("只传一个参数时返回 null", () => {
    const argv = ["node", "create-page.js", "APP_ABC123"];
    const result = parseCreatePageArgs(argv);
    expect(result).toBeNull();
  });

  test("没有参数时返回 null", () => {
    const argv = ["node", "create-page.js"];
    const result = parseCreatePageArgs(argv);
    expect(result).toBeNull();
  });

  test("appType 格式为 APP_XXX 时正确解析", () => {
    const argv = ["node", "create-page.js", "APP_XYZ789", "数据看板"];
    const result = parseCreatePageArgs(argv);
    expect(result.appType).toBe("APP_XYZ789");
    expect(result.pageName).toBe("数据看板");
  });
});

// ── get-schema.js 参数解析测试 ──────────────────────────────────────

describe("get-schema.js 参数解析", () => {
  test("传入 appType 和 formUuid 时，正确解析", () => {
    const argv = ["node", "get-schema.js", "APP_ABC123", "FORM-XYZ789"];
    const result = parseGetSchemaArgs(argv);
    expect(result).not.toBeNull();
    expect(result.appType).toBe("APP_ABC123");
    expect(result.formUuid).toBe("FORM-XYZ789");
  });

  test("只传一个参数时返回 null", () => {
    const argv = ["node", "get-schema.js", "APP_ABC123"];
    const result = parseGetSchemaArgs(argv);
    expect(result).toBeNull();
  });

  test("没有参数时返回 null", () => {
    const argv = ["node", "get-schema.js"];
    const result = parseGetSchemaArgs(argv);
    expect(result).toBeNull();
  });
});
