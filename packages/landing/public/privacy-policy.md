# Privacy Policy

Last updated: November 3, 2026

## 1. Introduction

MoneyMatter ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our personal finance application.

## 2. Information We Collect

- **Account Information:** Email address and password if you sign up with email. If you add a passkey, we store its public key.
- **Sign-In Providers:** If you sign in with Apple, Google or GitHub, the provider never shares your password with us. We store the tokens it issues for the sign-in, and we receive:
  - Apple: a unique account identifier, your email address (or a private relay address if you choose Hide My Email), whether it is verified, and your name if you share it.
  - Google: a unique account identifier, your name, email address, profile picture and whether the email address is verified.
  - GitHub: a unique account identifier, your name or username, profile picture, and your email addresses and whether they are verified. We keep one of them as your account email.
- **Financial Data:** Transaction records, account balances, categories, and budgets that you enter or sync from connected banks.
- **Precise Location (optional):** If you choose to tag a transaction with your current location, we receive your device's precise coordinates. The iOS app asks for this permission only while the app is in use, and you can decline it and still use the app. We store the coordinates with the transaction, or on a payee if you save them as its default location, to record where a transaction happened. You can remove them at any time.
- **Photos and Files (optional):** Receipt or document photos and PDF files you attach to a transaction, taken with your camera or chosen from your photos or files, along with their file names. We receive only the files you choose to attach.
- **Bank Connection Credentials:** If you use bank integrations, we store encrypted API credentials to maintain your connections.
- **Session Data:** IP address and browser or device details for each active session, so you can review your sessions and sign them out.
- **Usage Data:** Basic analytics to improve the application experience, linked to your app user ID, email address and username.
- **Billing Data:** If you subscribe on the web, Stripe collects your payment details and billing address directly; we never receive your card number. We store the Stripe customer and subscription identifiers and the status, plan and renewal date of your subscription. If you subscribe in the iOS app, Apple collects your payment details directly. We receive the signed transaction and Apple's subscription updates, and we store the App Store transaction identifier, the status, plan and renewal date of your subscription, and a random token that links the purchase to your account.

## 3. How We Use Your Information

- To provide and maintain the MoneyMatter service
- To sign you in and activate your subscription plan
- To sync your financial data from connected bank accounts
- To categorize and analyze your transactions
- To send important service-related notifications
- To improve and optimize the application

## 4. Data Storage and Security

Your data is stored securely in our database. Sensitive information such as bank API credentials is encrypted at rest.

If you self-host MoneyMatter, your data remains entirely on your own infrastructure and never touches our servers.

## 5. Third-Party Services

We may use third-party services for:

- Payments and subscriptions on the web: Stripe, acting as merchant of record under Stripe Managed Payments. Stripe processes your payment, collects applicable taxes and issues receipts under its own [privacy policy](https://stripe.com/privacy)
- Payments and subscriptions in the iOS app: Apple In-App Purchase (StoreKit). Apple processes your payment under its own [privacy policy](https://www.apple.com/legal/privacy/), and our backend receives the signed transaction to activate your plan
- Sign-in (Apple, Google, GitHub), if you choose one of them
- Bank data aggregation (Monobank API, Enable Banking, Lunch Flow, SimpleFIN, Walutomat, Akahu), if you connect them
- AI features, such as transaction categorization, invoice matching, statement import and spending tracker scans. We send the transaction details these features need (such as amount, note, payee and account name) and any files you run through them to OpenAI, Anthropic or Google, or to your own AI provider or custom endpoint if you configure one
- Transactional email (Resend), for sign-in, verification and account notices
- File storage (Cloudflare R2), for transaction attachments
- Maps and address search (OpenStreetMap), only if you turn on the map picker. Your device then sends coordinates and search text directly to OpenStreetMap
- Error monitoring (Sentry) and product analytics (PostHog), used only to run and improve the Service. Both receive your app user ID, email address and username, which we derive from your name or email address. PostHog also receives product usage events and account properties such as your plan. Sentry also receives error reports, which can include a session replay with text and media masked

These services have their own privacy policies. Bank connections are made using your own credentials, and we act only as an intermediary.

## 6. Data Retention

We retain your data for as long as your account is active. You can request deletion of your account and all associated data at any time through the application settings.

After deletion we keep a one-way hash of your email address and the date it was first seen, so that a new account cannot restart the free trial. Transactions you added to an account shared with you stay on that account, with your username and profile picture. Attachment files are removed from storage by a periodic cleanup. Records already sent to Sentry and PostHog are not removed automatically; email us to request their removal.

Deleting your account cancels a Stripe subscription, but it cannot cancel an App Store subscription. Cancel that one in your Apple account.

## 7. Your Rights

- Access your personal data
- Export your financial data
- Request correction of inaccurate data
- Request deletion of your data
- Disconnect bank integrations at any time
- Delete all your data permanently at any time

## 8. Open Source

MoneyMatter is open source software. You can review exactly how we handle your data by examining our source code on [GitHub](https://github.com/letehaha/moneymatter).

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.

## 10. Contact Us

If you have questions about this Privacy Policy, email us at [support@moneymatter.app](mailto:support@moneymatter.app) or open an issue on our [GitHub repository](https://github.com/letehaha/moneymatter/issues).
