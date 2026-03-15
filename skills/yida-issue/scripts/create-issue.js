#!/usr/bin/env node
/**
 * yida-issue: 一句话给 OpenYida 提需求
 *
 * 用法：
 *   node create-issue.js <需求描述> [--repo openyida|yida-skills] [--type feature|bug] [--dry-run]
 *
 * 自动判断需求应该提到 openyida/openyida 还是 openyida/yida-skills，
 * 并通过 gh CLI 创建格式规范的 GitHub Issue。
 */

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ── 路由规则 ──────────────────────────────────────────────────────────

/**
 * openyida/openyida 仓库的关键词（平台工具、CLI、CI/CD 等）
 */
const OPENYIDA_KEYWORDS = [
  "cli", "命令行", "命令", "install", "安装脚本", "安装",
  "workflow", "ci", "cd", "github action", "贡献者", "contributor",
  "readme", "文档", "package", "npm", "发布工具", "版本管理",
  "openclaw", "openyida", "bin/yida", "yida shell", "yida config",
  "yida login命令", "yida logout命令",
];

/**
 * openyida/yida-skills 仓库的关键词（宜搭操作能力）
 */
const YIDA_SKILLS_KEYWORDS = [
  "登录", "登出", "login", "logout", "扫码", "cookie", "token", "csrf",
  "创建应用", "创建页面", "创建表单", "发布页面", "发布", "publish",
  "schema", "宜搭 api", "宜搭api", "skill", "表单", "应用", "页面",
  "宜搭", "aliwork", "yida-create", "yida-publish", "yida-get",
  "get-schema", "create-app", "create-page", "create-form",
  "批量", "导出", "字段", "数据", "接口",
];

/**
 * 根据需求描述自动判断目标仓库
 * @returns {'openyida/openyida' | 'openyida/yida-skills' | null} null 表示无法判断
 */
function detectTargetRepo(description) {
  const lowerDesc = description.toLowerCase();

  let openyidaScore = 0;
  let yidaSkillsScore = 0;

  for (const keyword of OPENYIDA_KEYWORDS) {
    if (lowerDesc.includes(keyword.toLowerCase())) {
      openyidaScore++;
    }
  }

  for (const keyword of YIDA_SKILLS_KEYWORDS) {
    if (lowerDesc.includes(keyword.toLowerCase())) {
      yidaSkillsScore++;
    }
  }

  if (openyidaScore === 0 && yidaSkillsScore === 0) {
    return null;
  }

  if (openyidaScore > yidaSkillsScore) {
    return "openyida/openyida";
  }

  if (yidaSkillsScore > openyidaScore) {
    return "openyida/yida-skills";
  }

  // 平分时返回 null，让用户手动选择
  return null;
}

/**
 * 判断 Issue 类型（feature 或 bug）
 */
function detectIssueType(description) {
  const lowerDesc = description.toLowerCase();
  const bugKeywords = ["bug", "错误", "报错", "失败", "异常", "不生效", "不显示", "崩溃", "修复", "fix"];
  for (const keyword of bugKeywords) {
    if (lowerDesc.includes(keyword)) {
      return "bug";
    }
  }
  return "feature";
}

/**
 * 生成 Issue 标题
 */
function generateTitle(description, issueType) {
  // 去掉开头的 bug:/feat:/feature: 前缀（如果有）
  const cleanDesc = description
    .replace(/^(bug|feat|feature|fix)\s*[:：]\s*/i, "")
    .trim();

  if (issueType === "bug") {
    return `bug: ${cleanDesc}`;
  }
  return `[Feature] ${cleanDesc}`;
}

/**
 * 生成 Issue body
 */
function generateBody(description, issueType, targetRepo) {
  const repoLabel = targetRepo === "openyida/openyida"
    ? "平台工具（CLI / CI / 安装脚本等）"
    : "宜搭操作能力（登录 / 创建应用 / 发布 / Schema 等）";

  if (issueType === "bug") {
    return `## Bug 描述

${description}

## 复现步骤

（请补充复现步骤）

1. 
2. 
3. 

## 期望行为

（请描述期望的正确行为）

## 实际行为

（请描述实际发生的错误行为）

## 环境信息

- OS：
- Node.js 版本：
- 相关版本：

---
> 此 Issue 由 [yida-issue skill](https://github.com/openyida/openyida-openclaw-skill) 自动创建，路由到 **${repoLabel}**。`;
  }

  return `## 需求描述

${description}

## 期望功能

（请补充详细的期望功能描述）

## 使用场景

（请描述此功能的使用场景和价值）

## 优先级

中

---
> 此 Issue 由 [yida-issue skill](https://github.com/openyida/openyida-openclaw-skill) 自动创建，路由到 **${repoLabel}**。`;
}

// ── 参数解析 ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    description: "",
    repo: null,
    type: null,
    dryRun: false,
  };

  const descParts = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo" && args[i + 1]) {
      const repoArg = args[++i].toLowerCase();
      if (repoArg === "openyida") {
        options.repo = "openyida/openyida";
      } else if (repoArg === "yida-skills") {
        options.repo = "openyida/yida-skills";
      } else {
        console.error(`❌ 无效的 --repo 参数：${repoArg}，可选值：openyida | yida-skills`);
        process.exit(1);
      }
    } else if (args[i] === "--type" && args[i + 1]) {
      const typeArg = args[++i].toLowerCase();
      if (typeArg === "bug" || typeArg === "feature" || typeArg === "feat") {
        options.type = typeArg === "feat" ? "feature" : typeArg;
      } else {
        console.error(`❌ 无效的 --type 参数：${typeArg}，可选值：feature | bug`);
        process.exit(1);
      }
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (!args[i].startsWith("--")) {
      descParts.push(args[i]);
    }
  }

  options.description = descParts.join(" ").trim();
  return options;
}

// ── 主流程 ────────────────────────────────────────────────────────────

function main() {
  const options = parseArgs(process.argv);

  if (!options.description) {
    console.error("❌ 请提供需求描述");
    console.error("");
    console.error("用法：");
    console.error("  node create-issue.js <需求描述> [--repo openyida|yida-skills] [--type feature|bug] [--dry-run]");
    console.error("");
    console.error("示例：");
    console.error('  node create-issue.js "希望支持批量导出表单数据"');
    console.error('  node create-issue.js "CLI 新增 yida list 命令" --repo openyida');
    console.error('  node create-issue.js "bug: 创建应用时图标颜色不生效" --type bug');
    process.exit(1);
  }

  console.log("🔍 分析需求...");
  console.log(`   需求：${options.description}`);
  console.log("");

  // 判断目标仓库
  let targetRepo = options.repo;
  if (!targetRepo) {
    targetRepo = detectTargetRepo(options.description);
  }

  if (!targetRepo) {
    console.log("⚠️  无法自动判断目标仓库，请手动指定：");
    console.log("");
    console.log("  --repo openyida      → openyida/openyida（CLI、CI/CD、安装脚本等平台工具）");
    console.log("  --repo yida-skills   → openyida/yida-skills（宜搭操作能力：登录/创建/发布/Schema）");
    console.log("");
    console.log("示例：");
    console.log(`  node create-issue.js "${options.description}" --repo yida-skills`);
    process.exit(1);
  }

  // 判断 Issue 类型
  const issueType = options.type || detectIssueType(options.description);

  // 生成标题和 body
  const title = generateTitle(options.description, issueType);
  const body = generateBody(options.description, issueType, targetRepo);

  const repoLabel = targetRepo === "openyida/openyida"
    ? "平台工具（CLI / CI / 安装脚本等）"
    : "宜搭操作能力（登录 / 创建应用 / 发布 / Schema 等）";

  console.log(`📦 目标仓库：${targetRepo}（${repoLabel}）`);
  console.log(`📝 Issue 类型：${issueType === "bug" ? "🐛 Bug" : "✨ Feature"}`);
  console.log(`📌 标题：${title}`);
  console.log("");

  if (options.dryRun) {
    console.log("🔍 [dry-run 模式] Issue 内容预览：");
    console.log("─".repeat(60));
    console.log(body);
    console.log("─".repeat(60));
    console.log("");
    console.log("✅ dry-run 完成，未实际创建 Issue");
    return;
  }

  // 检查 gh CLI 是否可用
  try {
    execSync("gh --version", { stdio: "pipe" });
  } catch {
    console.error("❌ 未找到 gh CLI，请先安装：https://cli.github.com/");
    process.exit(1);
  }

  // 创建 Issue（用临时文件传 body，避免 shell 转义导致换行符丢失）
  console.log("🚀 正在创建 Issue...");
  const bodyTempFile = path.join(os.tmpdir(), `yida-issue-body-${Date.now()}.md`);
  try {
    fs.writeFileSync(bodyTempFile, body, "utf-8");
    const label = issueType === "bug" ? "bug" : "enhancement";
    try {
      const result = execSync(
        `gh issue create --repo "${targetRepo}" --title "${title.replace(/"/g, '\\"')}" --body-file "${bodyTempFile}" --label "${label}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      console.log(`✅ Issue 创建成功：${result.trim()}`);
    } catch {
      // label 不存在时降级为不带 label 创建
      const result = execSync(
        `gh issue create --repo "${targetRepo}" --title "${title.replace(/"/g, '\\"')}" --body-file "${bodyTempFile}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      console.log(`✅ Issue 创建成功：${result.trim()}`);
    }
  } catch (error) {
    console.error(`❌ 创建 Issue 失败：${error.message}`);
    console.error("请确认：");
    console.error("  1. gh CLI 已登录（gh auth login）");
    console.error("  2. 你有对应仓库的访问权限");
    process.exit(1);
  } finally {
    try { fs.unlinkSync(bodyTempFile); } catch {}
  }
}

main();
