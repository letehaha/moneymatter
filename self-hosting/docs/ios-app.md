# Connect the iOS App

The MoneyMatter app from the App Store can use your self-hosted server instead
of MoneyMatter Cloud. On the sign-in screen tap **Self-hosted? Connect to your
server** and type the URL you open the app at in a browser, for example
`https://budget.example.com`.

## Requirements

- **HTTPS.** iOS refuses plain `http://`, also on a local network. Put the stack
  behind [your own reverse proxy](reverse-proxies.md), the
  [bundled Traefik overlay](traefik-overlay.md), or Tailscale HTTPS
  (`tailscale serve`).
- **One URL.** The app reaches the API at `<url>/api/v1`, which is how the
  default stack is served. Split-domain (`SELFHOST_API_DOMAIN`) and sub-path
  deployments are not supported by the app.
- **`BETTER_AUTH_URL` is the exact URL you type into the app** – same scheme,
  host and port. Apple, Google and GitHub sign-in are all bound to it. A
  mismatch is the first thing to check when one of them fails.
- **A current server.** The app checks the server's release version when you
  connect and asks you to update a server that is too old. A server built from
  source reports no version and is accepted.

## Signing in

| Method             | What it needs on your server                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Email and password | Nothing                                                                                                                                      |
| Sign in with Apple | Nothing. No Apple developer account, key or variable. Set `APPLE_NATIVE_SIGN_IN=false` to refuse it                                          |
| Google, GitHub     | Your own OAuth client (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`) with the redirect URI below |
| Forgot password    | Outbound email (`RESEND_API_KEY`). Without it the app hides the link                                                                         |

Redirect URI to register with Google or GitHub:

```
<BETTER_AUTH_URL>/api/v1/auth/callback/google
<BETTER_AUTH_URL>/api/v1/auth/callback/github
```

Sign in with Apple works in the app only. The self-hosted web app does not show
an Apple button unless you configure the Apple web flow yourself (see
`APPLE_CLIENT_ID` in the [environment reference](environment-reference.md)). An
account created with Apple in the app therefore has no way into the web app
until it gets a password. Sign up with email first, then link Apple from the
app's login methods.

New accounts created through Apple, Google or GitHub count against
`SYSTEM_MAX_SIGNUPS_ALLOWED` like any other signup.

## What does not work on a self-hosted server

- **Push notifications.** The app registers for push only with MoneyMatter
  Cloud. The APNs variables in the environment reference are for your own iOS
  build, not for the App Store app.
- **Passkeys in the app.** The App Store app is only associated with
  `moneymatter.app`, so iOS refuses a passkey for any other domain. Passkeys
  keep working in the web app.
- **Plan & billing.** A self-hosted server grants every feature, so the app
  hides that screen.

The app sends no analytics or crash reports while it is connected to your
server.

---

Troubleshooting: [troubleshooting.md](troubleshooting.md#ios-app-sign-in-with-apple-google-or-github-fails)
