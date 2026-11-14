# OpenControl tenant package

A Grok-Bot-style **business operator** configuration for OpenBot: one owner, one Chief of Staff
Bot that plans, executes, schedules Routines, creates its own specialist Bots (`bot-creator`),
learns Skills, and reports on a cadence. Skills, model and channels are inherited verbatim from
`examples/personal`; only `agents.yaml` (the operator) and `brand.yaml` (product name) differ.

## Why it is not active locally yet

The local server runs from the **published image**, and the image only carries the built-in
packages (`personal`, `fintech`). A package in the clone is not visible to the container without a
volume mount. Rather than add moving parts to the first boot, the plan is:

1. **Boot locally on the stock personal package** (`TENANT_PACKAGE_DIR=../examples/personal`).
2. **Apply the identity right after boot** — the seeded starter is an ordinary Bot: its name,
   subtitle, role and instructions are editable on its Setup page (or via the API). Paste in the
   Chief-of-Staff prompt from `agents.yaml`. Behavior is fully determined by the prompt, so this
   achieves the same result with zero boot risk.
3. **Use this package on AWS**, where we control the compose file. There it becomes active with:

   `docker-compose.override.yml`:
   ```yaml
   services:
     server:
       volumes:
         - ./examples/opencontrol:/app/examples/opencontrol:ro
   ```
   and in `.env`: `TENANT_PACKAGE_DIR=../examples/opencontrol`

## Files

| File | Purpose |
| --- | --- |
| `agents.yaml` | The Chief of Staff (operator persona) + verbatim `picked-harness` row |
| `brand.yaml` | Product name (`OpenControl`), tenant id kept as `openbot` for seed stability |
| `skills.yaml` | Copied from `examples/personal` — includes `bot-creator` and `skill-creator` |
| `model.yaml` | Copied from `examples/personal` — OpenAI provider, default model |
| `channels.yaml`, `knowledge.yaml` | Copied from `examples/personal` |
