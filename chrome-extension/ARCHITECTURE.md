# Chrome Extension Architecture

## Modules

- `state-machine.js`
  - Shared pure helpers for URL validation, page-state analysis and state labels.
  - Also owns stricter monitor-state transition rules.
  - Primary target for isolated regression checks.

- `diagnostic-logger.js`
  - Centralized capped debug log buffer and export helpers.
  - Used for production diagnostics without relying only on console output.

- `background.js`
  - Monitoring orchestration, alarms, Telegram integration, auto-login and monitor state persistence.
  - Should only coordinate flows and side effects.

- `content.js`
  - Lightweight page integration and safe indicator rendering.
  - Must avoid autonomous slot notifications outside background decisions.

- `popup.js`
  - Settings UI, health status, live monitor state, debug export and manual actions.
  - Should remain presentation-oriented where possible.

## Core states

- `idle`
- `running`
- `stopped`
- `loading`
- `auth`
- `captcha`
- `rate_limited`
- `no_slots`
- `potential_slots`
- `wrong_page`
- `auth_error`
- `error`

## Recommended test scenarios

1. Invalid TLS URL blocks start and shows error.
2. Auto-login enabled without session password shows warning in popup.
3. Auth page returns `auth` or `auth_error` state.
4. CAPTCHA page returns `captcha` without false slot alert.
5. Known no-slots page returns `no_slots`.
6. Rate-limited page returns `rate_limited` and triggers backoff.
7. Appointment page without no-slot markers returns `potential_slots`.
8. Popup live state updates when `monitorState` and `monitorReason` change.
9. Invalid state transition is logged and coerced into a visible error state.
10. Debug export contains last diagnostic snapshot and capped diagnostic log history.
