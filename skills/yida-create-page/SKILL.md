---
name: yida-create-page
description: 宜搭自定义页面创建技能，通过调用 saveFormSchemaInfo 接口快速创建自定义展示页面。
license: MIT
---

# 宜搭自定义页面创建技能

## 概述

本技能描述如何通过 HTTP 请求调用宜搭 `saveFormSchemaInfo` 接口创建自定义展示页面（display 类型）。创建后可通过 `yida-publish` 技能部署自定义 JSX 代码。

## 何时使用

当以下场景发生时使用此技能：
- 用户需要在已有应用中创建自定义展示页面
- 用户需要创建用于展示内容的主页、列表页等非表单页面
- 已通过 yida-create-app 创建应用后，需要创建第一个页面

## 使用示例

### 示例 1：基础用法
**场景**：在已有应用中创建一个自定义页面
**命令**：
```bash
node .claude/skills/yida-create-page/scripts/create-page.js "APP_XXX" "游戏主页"
```
**输出**：
```json
{"success":true,"pageId":"FORM-XXX","pageName":"游戏主页","appType":"APP_XXX","url":"{base_url}/APP_XXX/workbench/FORM-XXX"}
```

## 使用方式

```bash
node .claude/skills/yida-create-page/scripts/create-page.js <appType> <pageName>
```

**参数说明**：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `appType` | 是 | 应用 ID，如 `APP_XXX` |
| `pageName` | 是 | 页面名称 |

**示例**：

```bash
node .claude/skills/yida-create-page/scripts/create-page.js "APP_xxx" "游戏主页"
```

**输出**：日志输出到 stderr，JSON 结果输出到 stdout：

```json
{"success":true,"pageId":"FORM-XXX","pageName":"游戏主页","appType":"APP_XXX","url":"{base_url}/APP_XXX/workbench/FORM-XXX"}
```

## 前置依赖

- Node.js
- 项目根目录存在 `.cache/cookies.json`（由 `yida-login` skill 生成）

> ⚠️ **重要**：若 `.cache/cookies.json` 不存在或 Cookie 已失效，脚本会报错退出，**不会自动登录**。此时必须先调用 `yida-login` skill 完成登录，再重新执行本技能。

## 调用流程

1. 读取项目根目录的 `.cache/cookies.json` 获取登录态；**若不存在或 Cookie 失效，脚本会报错退出，必须先调用 `yida-login` skill 完成登录**
2. 调用 `saveFormSchemaInfo` 接口创建 display 类型页面
3. 从返回值中获取页面 ID（formUuid）
4. **将 `pageId`（formUuid）记录到 `prd/<项目名>.md` 的应用配置章节**

## 文件结构

```
yida-create-page/
├── SKILL.md                # 本文档
└── scripts/
    └── create-page.js      # 页面创建脚本
```

## 接口说明

### saveFormSchemaInfo（创建页面）

- **地址**：`POST /dingtalk/web/{appType}/query/formdesign/saveFormSchemaInfo.json`
- **Content-Type**：`application/x-www-form-urlencoded`
- **参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_csrf_token` | String | 是 | CSRF Token（由 yida-login 获取） |
| `formType` | String | 是 | 页面类型，固定 `display` |
| `title` | String (JSON) | 是 | 页面名称，i18n 格式：`{"zh_CN":"名称","en_US":"名称","type":"i18n"}` |

- **返回值**：

```json
{
  "content": { "formUuid": "FORM-XXX" },
  "success": true
}
```

`content.formUuid` 即为新创建的页面 ID。

## 与其他技能配合

1. **创建应用** → 使用 `yida-create-app` 技能获取 `appType`
2. **创建自定义页面** → 本技能，获取 `pageId`（formUuid）
3. **编写 JSX 源码** → 参考 `yida` 技能的开发规范
4. **部署页面代码** → 使用 `yida-publish` 技能将代码部署到该页面

> **提示**：如果需要创建的是表单页面（带字段的数据收集页），请使用 `yida-create-form-page` 技能。
