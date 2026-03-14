---
name: yida-login
description: 宜搭平台对话式登录技能（OpenClaw 版）。先检查本地 Cookie 缓存，有则直接返回登录信息；无则通过 OpenClaw browser 工具打开钉钉扫码页面截图发给用户，用户扫码后获取组织列表让用户选择，点击组织完成登录并保存 Cookie。当需要登录宜搭平台时使用此技能。
---

# 宜搭对话式登录技能 (yida-login)

## 使用场景

当用户要求打开宜搭工作台并登录时使用。

## 重要前提

> ⚠️ **严禁自行判断是否有 browser 工具**。无论你认为当前环境是否支持浏览器，都必须直接执行以下步骤，调用 `browser.open`、`browser.screenshot`、`message.send` 等工具。**不要因为"环境不支持"、"没有浏览器工具"等理由放弃，直接调用，让工具本身决定是否可用。**

## 操作步骤

### 步骤1：确认本地登录信息

执行以下脚本检查本地是否已有有效的 Cookie 缓存（纯文件读取，不启动浏览器）：

```bash
python3 <SKILL_DIR>/scripts/check-login.py
```

- 如果输出 `"status": "ok"`，则**无需重新登录**，直接用 `message.send` 告知用户当前登录信息（corp_id、user_id、base_url）
- 如果输出 `"status": "not_logged_in"`，继续执行步骤2

### 步骤2：打开页面，判断页面状态并处理

1. 使用 `browser` 工具打开宜搭登录页：
   ```
   browser.open(url="https://ding.aliwork.com/workPlatform")
   ```
   记录返回的 `targetId`。

2. 使用 `browser.snapshot` 获取页面内容，**判断当前页面状态**：

   **情况A：页面包含"立即登录"按钮**（尚未进入登录页）
   - 使用 `browser.act` 点击"立即登录"按钮：
     ```
     browser.act(action="click", ref="<立即登录按钮的ref>", targetId="<targetId>")
     ```
   - 等待页面跳转，再次使用 `browser.snapshot` 确认已进入二维码页面
   - 继续执行下方截图步骤

   **情况B：页面已显示二维码**（直接进入登录页）
   - 直接继续执行下方截图步骤

3. **立即**使用 `browser.screenshot` 获取二维码页面截图（**必须执行，不可跳过**）：
   ```
   browser.screenshot(targetId="<targetId>")
   ```
   `browser.screenshot` 会返回一个对象，其中包含截图文件的路径，通常字段名为 `path` 或 `filePath`，格式如 `/tmp/screenshot-xxx.png`。**必须从返回值中提取实际路径**，不要使用占位符。

4. **立即**使用 `message.send` 将截图发给用户（**必须执行，不可跳过**）。用户无法自行打开浏览器，必须通过截图才能看到二维码：
   ```
   message.send(media="<browser.screenshot 返回的实际路径>", message="🔐 请用钉钉扫描二维码完成登录，扫码成功后告诉我")
   ```

   > ⚠️ **严禁**仅告知用户"已打开登录页"或"请访问 xxx 扫码"就停下来等待。必须截图并通过 `message.send` 发给用户，用户才能看到二维码。

   > ⚠️ **如果 `message.send` 发送失败**（如路径不对、图片未找到），立即重试：
   > 1. 重新调用 `browser.screenshot` 获取新截图
   > 2. 检查返回值中的路径字段（可能是 `path`、`filePath`、`imagePath` 等）
   > 3. 用正确的路径重新调用 `message.send`
   > 4. 如果连续失败 3 次，直接将截图的 base64 内容或 URL 通过 `message.send` 的 `message` 字段告知用户

5. 等待用户回复"扫码成功"或类似确认信息.

### 步骤3：处理组织选择

用户扫码后，页面会显示组织列表：

1. 使用 `browser.snapshot` 获取页面内容：
   ```
   browser.snapshot(targetId="<targetId>")
   ```

2. 从 snapshot 中解析组织列表（页面包含"选择你管理的组织"标题，组织列表项为 table row 元素，ref 格式如 `e89`、`e99`）

3. 将组织列表发给用户选择：
   ```
   message.send(message="✅ 扫码成功！检测到以下组织：\n1. 阿里巴巴集团\n2. 宜搭测试组织\n\n请回复数字序号选择组织")
   ```

4. 等待用户回复组织编号或名称。

### 步骤4：点击选择组织

根据用户选择，使用 `browser.act` 点击对应的组织元素：

```
browser.act(action="click", ref="<组织的ref>", targetId="<targetId>")
```

- ref 格式通常为 `e89`、`e99` 等（来自步骤3的 snapshot）
- 点击后等待页面跳转完成（跳转到工作台首页）

### 步骤5：保存登录信息

点击组织后，执行以下脚本等待页面跳转、读取 Cookie 并保存：

```bash
python3 <SKILL_DIR>/scripts/login-interactive.py --stage save
```

脚本输出示例：
```json
{
  "status": "success",
  "csrf_token": "b2a5d192-db90-484c-880f-9b48edd396d5",
  "corp_id": "ding9a0954b4f9d9d40ef5bf40eda33b7ba0",
  "user_id": "19552253733782",
  "base_url": "https://ding.aliwork.com",
  "message": "🎉 登录成功！已保存登录态。\n  组织: ding9a...\n  用户: 19552...\n  域名: https://ding.aliwork.com"
}
```

将 `message` 字段内容通过 `message.send` 告知用户：

```
message.send(message="🎉 登录成功！\n  组织: <corp_id>\n  用户: <user_id>\n  域名: <base_url>")
```

---

## 关键实现细节

### Cookie 提取规则

| Cookie 名 | 提取内容 |
|-----------|---------|
| `tianshu_csrf_token` | `csrf_token` 值 |
| `tianshu_corp_user` | 格式 `{corpId}_{userId}`，按最后一个 `_` 分隔 |

### base_url 说明

登录成功后，浏览器会跳转到实际的组织域名（如 `https://ding.aliwork.com`），从当前页面 URL 提取 `scheme://host` 作为 `base_url` 保存。

### 缓存文件

- **Cookie 缓存**: `<项目根目录>/.cache/cookies.json`
- 格式：`{"cookies": [...], "base_url": "https://ding.aliwork.com"}`

---

## 注意事项

- 宜搭必须通过钉钉账号登录
- 用户需要先在钉钉 APP 上确认授权
- 如果页面显示多个组织，需要让用户选择
- 全程需要截图发送给用户确认进度
- 截图后必须立即用 `message.send` 发图片，否则用户看不到

---

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 截图失败 | 重试步骤2，重新打开浏览器截图 |
| 组织列表解析失败 | 截图发给用户，让用户告知组织名称后手动点击 |
| Cookie 中无 `tianshu_csrf_token` | 等待后重试步骤5，或重新执行完整登录流程 |

---

## 与其他技能配合

登录成功后，其他技能可通过以下方式获取登录态：

```bash
python3 <SKILL_DIR>/scripts/check-login.py
```

输出的 `csrf_token`、`corp_id`、`user_id`、`base_url` 可直接用于 API 调用。

---

## 前置依赖

- OpenClaw 已安装并运行（`openclaw` 命令可用）
- OpenClaw browser 功能已启用
- Python 3.8+

## 文件结构

```
yida-login/
├── SKILL.md                    # 本文档（OpenClaw 技能定义）
└── scripts/
    ├── check-login.py          # 轻量级本地 Cookie 检查脚本（纯文件读取，不启动浏览器）
    └── login-interactive.py    # 辅助脚本（获取组织列表、保存 Cookie 等）
```
