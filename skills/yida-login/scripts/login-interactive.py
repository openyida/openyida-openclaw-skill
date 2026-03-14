"""
yida-login: OpenClaw 对话式登录脚本

本脚本通过 OpenClaw browser CLI 实现三阶段对话式登录：
  阶段1 - 点击"扫码登录"tab，等待二维码渲染（打开浏览器和截图由 agent 工具完成）
  阶段2 - 用户扫码后，获取组织列表，发给用户选择
  阶段3 - 用户选择组织后，点击对应组织，提取并保存 Cookie
  save  - agent 已点击组织后，仅读取当前浏览器 Cookie 并保存

本脚本由 OpenClaw agent 调用，通过 --stage 参数控制当前阶段。"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── 项目根目录定位 ────────────────────────────────────

def find_project_root(start_dir):
    """从 start_dir 向上查找含 README.md 或 .git 的项目根目录。"""
    current = start_dir
    while True:
        if os.path.exists(os.path.join(current, "README.md")) or os.path.isdir(os.path.join(current, ".git")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return start_dir
        current = parent

PROJECT_ROOT = find_project_root(SCRIPT_DIR)
CONFIG_FILE = os.path.join(PROJECT_ROOT, "config.json")
COOKIE_FILE = os.path.join(PROJECT_ROOT, ".cache", "cookies.json")

# 临时状态文件：在阶段之间传递组织列表等状态
LOGIN_STATE_FILE = os.path.join(PROJECT_ROOT, ".cache", "login-interactive-state.json")

# ── 配置加载 ──────────────────────────────────────────

def load_config():
    """从项目根目录的 config.json 读取配置。"""
    if not os.path.exists(CONFIG_FILE):
        log("⚠️  config.json 不存在，使用默认值")
        return {
            "loginUrl": "https://www.aliwork.com/workPlatform",
            "defaultBaseUrl": "https://www.aliwork.com"
        }
    with open(CONFIG_FILE, "r", encoding="utf-8") as file:
        return json.load(file)

_config = load_config()
LOGIN_URL = _config["loginUrl"]
DEFAULT_BASE_URL = _config["defaultBaseUrl"]

# ── 日志工具 ──────────────────────────────────────────

def log(message):
    """输出调试日志到 stderr，不影响 stdout 的 JSON 输出。"""
    print(f"[yida-login-v2] {message}", file=sys.stderr)

# ── Cookie 持久化（复用自 login.py）─────────────────

def save_login_cache(cookies, base_url=None):
    """将 Cookie 和 base_url 一起保存到本地缓存文件。"""
    cache_dir = os.path.dirname(COOKIE_FILE)
    os.makedirs(cache_dir, exist_ok=True)
    cache = {"cookies": cookies, "base_url": base_url}
    with open(COOKIE_FILE, "w", encoding="utf-8") as file:
        json.dump(cache, file, ensure_ascii=False, indent=2)
    log(f"Cookie 已保存到 {COOKIE_FILE}")

def load_login_cache():
    """从本地文件加载缓存，返回 (cookies, base_url)。"""
    if not os.path.exists(COOKIE_FILE):
        return None, None
    with open(COOKIE_FILE, "r", encoding="utf-8") as file:
        content = file.read().strip()
    if not content:
        return None, None
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return None, None

    if isinstance(data, dict) and "cookies" in data:
        cookies = data["cookies"] if data["cookies"] else None
        base_url = data.get("base_url")
        return cookies, base_url

    if isinstance(data, list) and data:
        return data, None

    return None, None

def extract_info_from_cookies(cookies):
    """从 Cookie 列表中提取 csrf_token、corp_id、user_id。"""
    csrf_token = None
    corp_id = None
    user_id = None

    for cookie in cookies:
        if cookie.get("name") == "tianshu_csrf_token":
            csrf_token = cookie.get("value")
        elif cookie.get("name") == "tianshu_corp_user":
            value = cookie.get("value", "")
            last_underscore = value.rfind("_")
            if last_underscore > 0:
                corp_id = value[:last_underscore]
                user_id = value[last_underscore + 1:]

    return csrf_token, corp_id, user_id

# ── 阶段状态持久化 ────────────────────────────────────

def save_login_state(state):
    """保存阶段间共享状态（如组织列表）到临时文件。"""
    cache_dir = os.path.dirname(LOGIN_STATE_FILE)
    os.makedirs(cache_dir, exist_ok=True)
    with open(LOGIN_STATE_FILE, "w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2)

def load_login_state():
    """加载阶段间共享状态。"""
    if not os.path.exists(LOGIN_STATE_FILE):
        return {}
    with open(LOGIN_STATE_FILE, "r", encoding="utf-8") as file:
        content = file.read().strip()
    if not content:
        return {}
    try:
        return json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return {}

def clear_login_state():
    """清理临时状态文件。"""
    if os.path.exists(LOGIN_STATE_FILE):
        os.remove(LOGIN_STATE_FILE)

# ── OpenClaw browser CLI 封装 ─────────────────────────
#
# 重要：openclaw browser 命令的 --json 是顶层选项，格式为：
#   openclaw browser --json <subcommand> [subcommand-options]
# 而不是：
#   openclaw browser <subcommand> --json
#
# 但并非所有子命令都支持 JSON 输出。经过实际验证：
#   - screenshot: 输出 MEDIA:<path> 纯文本，不支持 --json
#   - snapshot:   输出纯文本快照，不支持 --json
#   - navigate:   无输出，不支持 --json
#   - start:      无输出，不支持 --json
#   - click:      无输出，不支持 --json
#   - wait:       无输出，不支持 --json
#   - cookies:    支持 --json（顶层选项），输出 JSON
#   - evaluate:   支持 --json（顶层选项），输出 JSON
#
# 因此，我们针对不同命令使用不同的封装函数。

def run_simple_command(subcommand_args):
    """
    执行不需要 JSON 输出的 browser 命令（navigate/start/click/wait 等）。
    返回 (success: bool, stdout: str, stderr: str)。
    """
    command = ["openclaw", "browser"] + subcommand_args
    log(f"执行: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.returncode != 0:
            log(f"命令失败 (exit {result.returncode}): {result.stderr.strip()}")
            return False, result.stdout, result.stderr
        return True, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        log("命令超时")
        return False, "", "命令超时"
    except FileNotFoundError:
        log("openclaw 命令未找到，请确认 OpenClaw 已安装并在 PATH 中")
        return False, "", "openclaw 命令未找到"

def run_json_command(subcommand_args):
    """
    执行支持 JSON 输出的 browser 命令（cookies/evaluate 等）。
    --json 放在顶层选项位置：openclaw browser --json <subcommand> [options]
    返回解析后的 dict，失败时返回 {"error": "..."}。
    """
    # --json 是顶层选项，必须放在 browser 和子命令之间
    command = ["openclaw", "browser", "--json"] + subcommand_args
    log(f"执行: {' '.join(command)}")
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=60
        )
        if result.returncode != 0:
            log(f"命令失败 (exit {result.returncode}): {result.stderr.strip()}")
            return {"error": result.stderr or f"exit code {result.returncode}"}
        output = result.stdout.strip()
        if not output:
            return {"ok": True}
        return json.loads(output)
    except subprocess.TimeoutExpired:
        return {"error": "命令超时"}
    except json.JSONDecodeError as parse_error:
        log(f"JSON 解析失败: {parse_error}")
        return {"error": f"JSON 解析失败: {parse_error}", "raw": result.stdout[:500]}
    except FileNotFoundError:
        return {"error": "openclaw 命令未找到，请确认 OpenClaw 已安装并在 PATH 中"}

def browser_screenshot():
    """
    截取当前页面截图。
    输出格式：MEDIA:<path>（纯文本，不是 JSON）
    返回截图文件路径，失败返回 None。
    """
    success, stdout, stderr = run_simple_command(["screenshot"])
    if not success:
        log(f"截图失败: {stderr}")
        return None

    # 解析 MEDIA:<path> 格式
    for line in stdout.splitlines():
        line = line.strip()
        if line.startswith("MEDIA:"):
            screenshot_path = line[len("MEDIA:"):].strip()
            log(f"截图路径: {screenshot_path}")
            return screenshot_path

    log(f"截图输出中未找到 MEDIA 路径，原始输出: {stdout[:300]}")
    return None

def browser_snapshot_interactive():
    """
    获取页面可交互元素快照（纯文本格式）。
    输出是 AI snapshot 格式的纯文本，包含 aria-ref="N" 形式的引用。
    返回 (success: bool, snapshot_text: str)。
    """
    success, stdout, stderr = run_simple_command(["snapshot", "--interactive"])
    return success, stdout

def browser_click(ref):
    """点击指定 ref 的元素。ref 来自 snapshot 输出。"""
    success, stdout, stderr = run_simple_command(["click", ref])
    return success

def browser_wait_selector(selector, timeout_ms=15000):
    """
    等待 CSS selector 对应的元素出现（可见）。
    selector 是位置参数：openclaw browser wait <selector> --timeout-ms <ms>
    """
    success, stdout, stderr = run_simple_command([
        "wait", selector,
        "--timeout-ms", str(timeout_ms)
    ])
    return success

def browser_wait_url(url_pattern, timeout_ms=30000):
    """等待页面 URL 匹配指定 glob 模式。"""
    success, stdout, stderr = run_simple_command([
        "wait",
        "--url", url_pattern,
        "--timeout-ms", str(timeout_ms)
    ])
    return success

def browser_cookies():
    """
    读取当前页面所有 Cookie。
    使用 --json 顶层选项：openclaw browser --json cookies
    返回 Cookie 列表，失败返回空列表。
    """
    result = run_json_command(["cookies"])
    if "error" in result:
        log(f"读取 Cookie 失败: {result['error']}")
        return []
    # cookies 命令返回格式：{"cookies": [...]} 或直接是列表
    if isinstance(result, list):
        return result
    return result.get("cookies") or result.get("items") or result.get("data") or []

def browser_evaluate(js_fn):
    """
    在页面中执行 JS 函数。
    使用 --json 顶层选项：openclaw browser --json evaluate --fn <code>
    返回执行结果。
    """
    result = run_json_command(["evaluate", "--fn", js_fn])
    return result

def get_current_page_url():
    """
    通过 JS 获取当前页面 URL。
    使用 evaluate 命令执行 () => window.location.href。
    返回 URL 字符串，失败返回空字符串。
    """
    result = browser_evaluate("() => window.location.href")
    if "error" in result:
        return ""
    # evaluate 结果通常在 result 字段
    url = result.get("result") or result.get("value") or result.get("returnValue") or ""
    if isinstance(url, str):
        return url
    return ""

# ── snapshot 文本解析工具 ─────────────────────────────
#
# OpenClaw snapshot --interactive 输出的是 AI snapshot 纯文本格式，
# 示例：
#   button "扫码登录" [aria-ref="12"]
#   button "账号密码登录" [aria-ref="13"]
#   listitem "阿里巴巴集团" [aria-ref="25"]
#
# 数字 ref（如 12）用于 click 命令：openclaw browser click 12

def parse_snapshot_refs(snapshot_text):
    """
    从 snapshot --interactive 的纯文本输出中解析元素 ref 和名称。

    AI snapshot 格式示例：
      button "扫码登录" [aria-ref="12"]
      listitem "阿里巴巴集团" [aria-ref="25"]

    返回列表：[{"role": "button", "name": "扫码登录", "ref": "12"}, ...]
    """
    elements = []
    # 匹配格式：<role> "<name>" [aria-ref="<ref>"]
    # 或：<role> '<name>' [aria-ref="<ref>"]
    pattern = re.compile(
        r'(\w+)\s+"([^"]+)"\s+\[aria-ref="(\d+)"\]'
        r'|(\w+)\s+\'([^\']+)\'\s+\[aria-ref="(\d+)"\]'
    )
    for match in pattern.finditer(snapshot_text):
        if match.group(1):
            role, name, ref = match.group(1), match.group(2), match.group(3)
        else:
            role, name, ref = match.group(4), match.group(5), match.group(6)
        elements.append({"role": role, "name": name, "ref": ref})

    # 备用：匹配更宽松的格式（有些版本可能不带引号）
    if not elements:
        loose_pattern = re.compile(r'\[aria-ref="(\d+)"\]')
        # 逐行解析
        for line in snapshot_text.splitlines():
            ref_match = loose_pattern.search(line)
            if ref_match:
                ref = ref_match.group(1)
                # 提取行中的文本内容（去掉 ref 标记后的剩余文本）
                text = loose_pattern.sub("", line).strip()
                # 提取角色（行首第一个单词）
                parts = text.split(None, 1)
                role = parts[0].lower() if parts else "unknown"
                name = parts[1].strip('"\'') if len(parts) > 1 else ""
                if name:
                    elements.append({"role": role, "name": name, "ref": ref})

    return elements

def find_ref_by_keywords(snapshot_text, keywords):
    """
    在 snapshot 文本中按关键词查找元素 ref。
    返回第一个匹配的 ref 字符串，未找到返回 None。
    """
    elements = parse_snapshot_refs(snapshot_text)
    for element in elements:
        element_name = element.get("name", "").lower()
        for keyword in keywords:
            if keyword.lower() in element_name:
                log(f"找到匹配元素: role={element['role']}, name={element['name']}, ref={element['ref']}")
                return element["ref"]
    return None

# ── 阶段1：点击扫码 tab，等待二维码 canvas 出现 ───────
#
# 注意：打开浏览器和截图由 OpenClaw agent 通过工具调用完成：
#   1. agent 调用 browser.open(url=loginUrl) 打开登录页
#   2. agent 调用本脚本 --stage 1，完成"点击扫码tab + 等待canvas"
#   3. agent 调用 browser.screenshot(targetId=...) 截图
#   4. agent 调用 message.send(media=<截图路径>) 发给用户

def stage1_click_qrcode_tab_and_wait_canvas(session_id):
    """
    阶段1（由 agent 在 browser.open 之后调用）：
    1. 等待页面初始加载
    2. 获取 snapshot，查找"扫码登录" tab 并点击
    3. 短暂等待二维码渲染后立即返回（截图由 agent 工具完成）

    注意：不等待 canvas 出现，直接使用页面截图获取二维码，
    避免等待时间过长导致二维码过期。
    """
    log("=== 阶段1：点击扫码 tab，准备截图 ===")

    # 1. 等待页面初始加载
    log("等待页面初始加载（3秒）...")
    time.sleep(3)

    # 2. 获取 snapshot，查找"扫码登录" tab 并点击
    log("获取页面快照，查找扫码登录 tab...")
    snapshot_success, snapshot_text = browser_snapshot_interactive()

    if snapshot_success and snapshot_text:
        qrcode_tab_ref = find_ref_by_keywords(
            snapshot_text,
            ["扫码登录", "扫码", "二维码", "qrcode", "scan"]
        )
        if qrcode_tab_ref:
            log(f"找到扫码登录 tab，ref={qrcode_tab_ref}，点击...")
            if browser_click(qrcode_tab_ref):
                log("已点击扫码登录 tab，等待二维码渲染（2秒）...")
                time.sleep(2)
            else:
                log("点击扫码 tab 失败（可能已在扫码页面），继续截图")
        else:
            log("未在快照中找到扫码登录 tab（可能已在扫码页面），继续截图")
    else:
        log("获取快照失败，继续截图")

    # 3. 立即返回，告知 agent 可以截图了
    # 不等待 canvas，直接使用页面截图获取二维码，避免等待过长导致二维码过期
    save_login_state({"stage": 1})
    output_result({
        "stage": 1,
        "status": "ready_for_screenshot",
        "message": "二维码页面已就绪，请立即截图并发给用户扫码。",
        "instruction": "请执行：browser.screenshot(targetId=...) 然后 message.send(media=<截图路径>, message='🔐 请用钉钉扫描二维码完成登录，扫码成功后告诉我')"
    })

# ── 阶段2：获取组织列表 ───────────────────────────────

def stage2_get_org_list(session_id):
    """
    阶段2（用户扫码成功后调用）：
    1. 等待页面跳转（扫码成功后跳转到组织选择页）
    2. 获取页面快照，提取组织列表
    3. 输出组织列表供用户选择
    """
    log("=== 阶段2：获取组织列表 ===")

    # 等待页面跳转（扫码后通常会跳转到组织选择页）
    log("等待页面跳转（最多 10 秒）...")
    time.sleep(2)

    # 获取页面快照
    log("获取页面快照，提取组织列表...")
    snapshot_success, snapshot_text = browser_snapshot_interactive()

    organizations = []
    if snapshot_success and snapshot_text:
        organizations = extract_org_list_from_snapshot(snapshot_text)

    if not organizations:
        # 未能自动提取，截图让用户手动确认
        log("未能自动提取组织列表，截图供参考...")
        screenshot_path = browser_screenshot()
        save_login_state({
            "stage": 2,
            "organizations": [],
            "screenshot_path": screenshot_path
        })
        output_result({
            "stage": 2,
            "status": "org_list_manual",
            "screenshot_path": screenshot_path,
            "message": (
                "✅ 扫码成功！未能自动识别组织列表，请查看截图。\n"
                "请告诉我您要选择的组织序号（从截图中数第几个组织）。"
            ),
            "organizations": []
        })
        return

    # 保存组织列表到状态文件，供阶段3使用
    save_login_state({
        "stage": 2,
        "organizations": organizations
    })

    org_list_text = "\n".join(
        f"  {index + 1}. {org['name']}" for index, org in enumerate(organizations)
    )

    output_result({
        "stage": 2,
        "status": "waiting_for_org_selection",
        "organizations": organizations,
        "message": (
            f"✅ 扫码成功！检测到以下组织，请回复序号选择：\n\n"
            f"{org_list_text}\n\n"
            f"请回复数字序号（如：1）"
        ),
        "instruction": "请回复您要登录的组织序号"
    })

def extract_org_list_from_snapshot(snapshot_text):
    """
    从 snapshot --interactive 的纯文本输出中提取组织列表。

    宜搭组织选择页的组织卡片通常是 button 或 listitem 角色。
    过滤掉导航按钮（登录、退出、返回等）。

    返回格式：[{"name": "组织名", "ref": "12"}, ...]
    """
    elements = parse_snapshot_refs(snapshot_text)
    organizations = []

    # 需要过滤掉的非组织元素关键词
    skip_keywords = [
        "登录", "退出", "返回", "取消", "确认", "ok", "cancel", "back",
        "next", "下一步", "上一步", "prev", "close", "关闭", "刷新",
        "refresh", "扫码", "账号", "密码", "手机", "验证码"
    ]

    # 组织卡片通常是 button、listitem、option、menuitem 角色
    org_roles = {"button", "listitem", "option", "menuitem", "link", "tab"}

    for element in elements:
        role = element.get("role", "").lower()
        name = element.get("name", "").strip()
        ref = element.get("ref", "")

        if role not in org_roles:
            continue
        if not name or len(name) < 2:
            continue
        if any(skip.lower() in name.lower() for skip in skip_keywords):
            continue

        organizations.append({"name": name, "ref": ref})

    return organizations

# ── 阶段3：点击组织，完成登录，保存 Cookie ────────────

def stage3_select_org_and_save_cookies(session_id, org_index):
    """
    阶段3（用户选择组织序号后调用）：
    1. 从状态文件加载组织列表
    2. 点击对应序号的组织
    3. 等待登录完成（跳转到 workPlatform）
    4. 读取 Cookie 并保存
    5. 输出登录结果
    """
    log(f"=== 阶段3：选择组织 #{org_index}，完成登录 ===")

    state = load_login_state()
    organizations = state.get("organizations", [])

    # 验证序号范围
    if org_index < 1:
        output_error(f"无效的组织序号 {org_index}，序号必须从 1 开始")
        return
    if organizations and org_index > len(organizations):
        output_error(f"无效的组织序号 {org_index}，有效范围：1-{len(organizations)}")
        return

    # 点击对应组织
    if organizations:
        selected_org = organizations[org_index - 1]
        org_name = selected_org.get("name", f"组织#{org_index}")
        org_ref = selected_org.get("ref", "")
        log(f"选择组织: {org_name} (ref={org_ref})")

        click_success = False
        if org_ref:
            click_success = browser_click(org_ref)
            if not click_success:
                log(f"点击组织 ref={org_ref} 失败，重新获取快照后重试...")
                # ref 可能已过期，重新获取快照
                snapshot_success, snapshot_text = browser_snapshot_interactive()
                if snapshot_success and snapshot_text:
                    fresh_orgs = extract_org_list_from_snapshot(snapshot_text)
                    if fresh_orgs and org_index <= len(fresh_orgs):
                        fresh_ref = fresh_orgs[org_index - 1].get("ref", "")
                        if fresh_ref:
                            log(f"使用新 ref={fresh_ref} 重试点击...")
                            click_success = browser_click(fresh_ref)

        if not click_success:
            # 最后手段：通过 JS 按序号点击
            log(f"通过 JS 按序号 {org_index - 1} 点击组织元素...")
            browser_evaluate(
                f"() => {{"
                f"  const candidates = Array.from(document.querySelectorAll("
                f"    '[class*=corp], [class*=org], [class*=company], [class*=tenant],"
                f"    [class*=enterprise], li[class], .corp-item, .org-item'"
                f"  ));"
                f"  const target = candidates[{org_index - 1}];"
                f"  if (target) target.click();"
                f"}}"
            )
    else:
        # 无组织列表（阶段2未能提取），重新获取快照按序号点击
        log(f"无缓存组织列表，重新获取快照按序号 {org_index} 点击...")
        snapshot_success, snapshot_text = browser_snapshot_interactive()
        if snapshot_success and snapshot_text:
            fresh_orgs = extract_org_list_from_snapshot(snapshot_text)
            if fresh_orgs and org_index <= len(fresh_orgs):
                fresh_ref = fresh_orgs[org_index - 1].get("ref", "")
                if fresh_ref:
                    browser_click(fresh_ref)
                else:
                    output_error(f"无法找到序号 {org_index} 对应的组织元素")
                    return
            else:
                output_error(f"页面中未找到足够的组织选项（找到 {len(fresh_orgs)} 个，需要第 {org_index} 个）")
                return
        else:
            output_error("无法获取页面快照，请检查浏览器状态")
            return

    # 等待登录完成（跳转到 workPlatform）
    log("等待登录完成（跳转到 workPlatform，最多 30 秒）...")
    login_redirected = browser_wait_url("**/workPlatform**", timeout_ms=30000)
    if login_redirected:
        log("检测到跳转到 workPlatform，登录成功")
    else:
        log("30秒内未检测到跳转，尝试直接读取 Cookie（登录可能已完成）")

    # 读取 Cookie
    log("读取浏览器 Cookie...")
    cookies = browser_cookies()

    if not cookies:
        output_error("无法读取 Cookie，登录可能未完成。请确认已选择组织并等待页面跳转。")
        return

    # 提取登录信息
    csrf_token, corp_id, user_id = extract_info_from_cookies(cookies)

    if not csrf_token:
        output_error(
            "Cookie 中无 tianshu_csrf_token，登录可能未完成。"
            "请确认已成功选择组织并等待页面完全加载后重试。"
        )
        return

    # 获取当前页面 URL 作为 base_url
    current_url = get_current_page_url()
    if current_url:
        parsed = urlparse(current_url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"
        log(f"当前页面 URL: {current_url}，base_url: {base_url}")
    else:
        base_url = DEFAULT_BASE_URL
        log(f"无法获取当前 URL，使用默认 base_url: {base_url}")

    # 保存 Cookie 到缓存文件
    save_login_cache(cookies, base_url)

    # 清理临时状态文件
    clear_login_state()

    log(f"✅ 登录成功！csrf_token: {csrf_token[:16]}...")
    log(f"✅ corp_id: {corp_id}, user_id: {user_id}, base_url: {base_url}")

    output_result({
        "stage": 3,
        "status": "success",
        "csrf_token": csrf_token,
        "corp_id": corp_id,
        "user_id": user_id,
        "base_url": base_url,
        "cookies": cookies,
        "message": (
            f"🎉 登录成功！已保存登录态。\n"
            f"  组织: {corp_id}\n"
            f"  用户: {user_id}\n"
            f"  域名: {base_url}"
        )
    })

# ── save 模式：agent 点击组织后，读取 Cookie 并保存 ──

def save_cookies_after_agent_click(session_id):
    """
    save 模式（由 agent 在 browser.act 点击组织后调用）：
    1. 等待页面跳转完成
    2. 读取当前浏览器 Cookie
    3. 提取登录信息并保存到缓存文件
    4. 输出登录结果

    适用于新流程：agent 直接用 browser.act 点击组织，
    本函数只负责读取 Cookie 和保存，不做任何点击操作。
    """
    log("=== save 模式：读取 Cookie 并保存登录信息 ===")

    # 等待页面跳转完成（跳转到 workPlatform）
    log("等待登录完成（跳转到 workPlatform，最多 30 秒）...")
    login_redirected = browser_wait_url("**/workPlatform**", timeout_ms=30000)
    if login_redirected:
        log("检测到跳转到 workPlatform，登录成功")
    else:
        log("30秒内未检测到跳转，尝试直接读取 Cookie（登录可能已完成）")

    # 读取 Cookie
    log("读取浏览器 Cookie...")
    cookies = browser_cookies()

    if not cookies:
        output_error("无法读取 Cookie，登录可能未完成。请确认已选择组织并等待页面跳转。")
        return

    # 提取登录信息
    csrf_token, corp_id, user_id = extract_info_from_cookies(cookies)

    if not csrf_token:
        output_error(
            "Cookie 中无 tianshu_csrf_token，登录可能未完成。"
            "请确认已成功选择组织并等待页面完全加载后重试。"
        )
        return

    # 获取当前页面 URL 作为 base_url
    current_url = get_current_page_url()
    if current_url:
        parsed = urlparse(current_url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"
        log(f"当前页面 URL: {current_url}，base_url: {base_url}")
    else:
        base_url = DEFAULT_BASE_URL
        log(f"无法获取当前 URL，使用默认 base_url: {base_url}")

    # 保存 Cookie 到缓存文件
    save_login_cache(cookies, base_url)

    # 清理临时状态文件
    clear_login_state()

    log(f"✅ 登录成功！csrf_token: {csrf_token[:16]}...")
    log(f"✅ corp_id: {corp_id}, user_id: {user_id}, base_url: {base_url}")

    output_result({
        "status": "success",
        "csrf_token": csrf_token,
        "corp_id": corp_id,
        "user_id": user_id,
        "base_url": base_url,
        "cookies": cookies,
        "message": (
            f"🎉 登录成功！已保存登录态。\n"
            f"  组织: {corp_id}\n"
            f"  用户: {user_id}\n"
            f"  域名: {base_url}"
        )
    })

# ── 输出工具 ──────────────────────────────────────────

def output_result(data):
    """将结果以 JSON 格式输出到 stdout（供 OpenClaw agent 读取）。"""
    print(json.dumps(data, ensure_ascii=False, indent=2))

def output_error(message):
    """输出错误结果并退出。"""
    output_result({"status": "error", "error": message})
    sys.exit(1)

# ── CLI 入口 ──────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="yida-login-v2: OpenClaw 对话式登录脚本"
    )
    parser.add_argument(
        "--stage",
        type=str,
        choices=["1", "2", "3", "save"],
        required=True,
        help=(
            "登录阶段：\n"
            "  1    = 点击扫码tab并等待二维码渲染\n"
            "  2    = 获取组织列表（用户扫码后调用）\n"
            "  3    = 点击组织并保存Cookie（脚本负责点击）\n"
            "  save = 仅读取当前浏览器Cookie并保存（agent已点击组织后调用）"
        )
    )
    parser.add_argument(
        "--session-id",
        type=str,
        default="",
        help="OpenClaw 会话 ID（当前版本仅用于日志记录，消息通过 stdout JSON 返回给 agent）"
    )
    parser.add_argument(
        "--org-index",
        type=int,
        default=1,
        help="阶段3使用：用户选择的组织序号（从1开始）"
    )

    args = parser.parse_args()

    log(f"启动阶段 {args.stage}，session_id={args.session_id}")

    if args.stage == "1":
        stage1_click_qrcode_tab_and_wait_canvas(args.session_id)
    elif args.stage == "2":
        stage2_get_org_list(args.session_id)
    elif args.stage == "3":
        stage3_select_org_and_save_cookies(args.session_id, args.org_index)
    elif args.stage == "save":
        save_cookies_after_agent_click(args.session_id)

if __name__ == "__main__":
    main()
