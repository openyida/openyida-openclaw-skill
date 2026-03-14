---
name: yida-logout
description: 宜搭平台退出登录技能，清空本地 Cookie 缓存内容。此技能用于：退出宜搭登录、清除宜搭登录态、切换宜搭账号、宜搭账号登录不同时使用此技能。
license: MIT
---

# 宜搭退出登录技能

## 概述

本技能提供宜搭平台的退出登录能力，通过清空本地 Cookie 缓存文件内容使登录态失效。下次使用 `yida-login` 时将重新打开浏览器进行扫码登录。

## 何时使用

当以下场景发生时使用此技能：
- 用户需要切换账号
- Cookie 失效且无法自动刷新
- 用户要求退出登录
- 需要切换到另一个组织

## 使用示例

### 示例 1：退出登录
**场景**：清空登录态缓存
**命令**：
```bash
echo -n "" > .cache/cookies.json
```

## 使用方式

清空项目根目录下的 `.cache/cookies.json` 缓存文件内容即可完成退出：

```bash
echo -n "" > .cache/cookies.json
```

## 工作流程

1. 清空项目根目录下的 `.cache/cookies.json` 文件内容（写入空字符串）
2. 下次调用 `yida-login` 时，因缓存内容为空，将通过 `yida-login` skill 的交互式流程（agent 用 browser 工具打开页面截图发给用户扫码）重新登录

> **注意**：Cookie 缓存文件位于**项目根目录**（含 `README.md` 或 `.git` 的目录）的 `.cache/` 目录下，而非 `yida-login/scripts/` 目录下。

## 与其他技能配合

- **`yida-login`**：退出后需重新登录时使用，会自动检测 Cookie 缓存为空并打开浏览器
- 退出登录不影响已部署的页面和已保存的数据
