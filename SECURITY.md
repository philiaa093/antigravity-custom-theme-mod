# Security policy

Report security issues privately via **Security > Advisories > Report a vulnerability** on GitHub. The maintainer should enable private vulnerability reporting before making the repository public. Do not post security details or credentials in a public issue. Include the affected commit or tag, Antigravity version, OS, affected component, and observed impact. Redact secrets, personal paths and media.

- Antigravity's debugging port grants control over the local renderer. Keep it and the Dashboard on loopback. Do not expose or proxy either port to a network.
- The Dashboard's Vision settings store a key unencrypted in the OS user profile. Use a scoped key and do not share that file, the live media token, or unredacted logs.
- The local palette does not call a provider. Use AI preview only with an endpoint you trust to receive the resized image and optional avatar crop.
- If credentials enter a commit, revoke or rotate them first. Ignoring a file or deleting it in a later commit does not remove its history.
