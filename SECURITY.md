# Security Policy

This repository is public on purpose. The live app is
https://leef-trader.vercel.app.

## Reporting a vulnerability

Please **do not** open a public issue for WAX session-key handling, signing,
quota-spend (`/api/jev`, `/api/token-risk`), XSS, or anything that could
move user funds.

Use a private GitHub security advisory:

https://github.com/leeftoken/leef-trader/security/advisories/new

Do **not** include session keys (`WIF` / `PVT_K1_`), Nostr `nsec`s, or API
tokens in the report. Describe impact, a reproduction, and (if you have
one) a suggested fix.

The threat model, key-handling rules, and transaction policy firewall are
documented in [docs/SECURITY.md](./docs/SECURITY.md).
