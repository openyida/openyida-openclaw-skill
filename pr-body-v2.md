## Summary

修复技能无法自动触发的问题。所有 yida-* 技能的 description 现在包含触发短语，AI 可以根据用户对话自动匹配技能。

## Problem

通过 ClawHub 安装技能后，直接对话无法命中技能，必须显式告诉 OpenClaw "使用 yida-app 技能" 才能触发。

例如：
- ❌ 用户说 "帮我做一个考勤应用" → 无法触发
- ✅ 用户说 "使用 yida-app 技能，帮我做一个考勤应用" → 正常触发

## Root Cause

OpenClaw 使用 description-based matching：
```
用户消息 → AI 分析 <available_skills> 中的 description → 决定是否加载技能
```

关键：**description 必须包含触发短语（trigger phrases）**，否则 AI 不知道何时使用该技能。

## Solution

在所有 yida-* 技能的 description 中添加触发短语，参考官方 skill-creator 的写法：

```yaml
---
name: yida-app
description: 宜搭完整应用开发技能...此技能用于：帮我搭建一个宜搭应用、帮我做一个xxx小程序...
---
```

## Changes

修改了以下 9 个技能的 SKILL.md：

| Skill | 修复前 | 修复后 |
|-------|-------|-------|
| yida-app | 无触发短语 | 添加触发短语 |
| yida-login | ✅ 已有 | 无需修改 |
| yida-logout | 无触发短语 | 添加触发短语 |
| yida-create-app | 无触发短语 | 添加触发短语 |
| yida-create-page | 无触发短语 | 添加触发短语 |
| yida-create-form-page | 无触发短语 | 添加触发短语 |
| yida-custom-page | 无触发短语 | 添加触发短语 |
| yida-publish-page | 无触发短语 | 添加触发短语 |
| yida-get-schema | 无触发短语 | 添加触发短语 |

## Expected Effect

修复后，用户说以下话应该能自动触发对应技能：

| 用户输入 | 预期触发的技能 |
|----------|---------------|
| "帮我做一个考勤应用" | yida-app |
| "我想创建个宜搭应用" | yida-create-app |
| "帮我发布这个页面" | yida-publish-page |
| "退出登录" | yida-logout |

## References

- OpenClaw Issue #43410: 34 built-in skills missing trigger phrases
- Anthropic Claude Code Skill Guide: "When to use it" section required in description
- This repo Issue #4

## Related Issue

Closes #4
