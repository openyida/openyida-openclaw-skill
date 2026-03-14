## Summary

- Add `--check-only` parameter to check login status without triggering login flow
- Add auto-select org logic: if only 1 organization detected, automatically select and complete login
- Add `can_auto_use` field for AI Agent to determine if login is available
- Add human-readable message output

## Changes

- Modified `skills/yida-login/scripts/login-interactive.py`:
  - Added `check_login_only()` function
  - Added `--check-only` CLI argument support
  - Modified `stage2_get_org_list()` to auto-select when only 1 org

## Usage

### Check login status
```bash
python3 login-interactive.py --check-only
```

Returns:
```json
{
  "status": "ok",
  "can_auto_use": true,
  "csrf_token": "xxx",
  "corp_id": "dingxxx",
  "user_id": "195xxx",
  "base_url": "https://ding.aliwork.com",
  "message": "✅ 已有有效登录态，可直接使用"
}
```

### Auto-select org
When user scans QR code and only 1 organization is detected, the login flow automatically completes without requiring user to reply with org number.

## User Experience Improvement

| Scenario | Before | After |
|----------|--------|-------|
| Already logged in | AI asks to continue | Use directly (no interaction) |
| 1 org detected | User replies with number | **Auto-select** |
| Multiple orgs | User replies with number | Still requires selection |

## Related Issue

Closes #2
