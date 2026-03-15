---
name: cm-upgrade
description: |
  Rebuild A8-Cortex locally. No remote pull.
  Trigger: /a8-cortex:cm-upgrade
user-invocable: true
---

# A8-Cortex Upgrade

Rebuild the local installation.

## Instructions

1. Derive the **plugin root** from this skill's base directory (go up 2 levels — remove `/skills/cm-upgrade`).
2. Run with Bash:
   ```
   cd "<PLUGIN_ROOT>" && npm run build
   ```
3. Run doctor to verify:
   ```
   CLI="<PLUGIN_ROOT>/cli.bundle.mjs"; [ ! -f "$CLI" ] && CLI="<PLUGIN_ROOT>/build/cli.js"; node "$CLI" doctor
   ```
4. Tell the user to **restart their Claude Code session** to pick up the new build.
