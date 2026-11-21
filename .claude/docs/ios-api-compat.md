# iOS API Compatibility

The iOS app (SwiftUI, separate repo) talks to this backend over HTTP only. App Store builds stay installed for months and cannot be patched, so every backend change must keep working for builds already shipped. A change in the iOS repo never resolves a compatibility problem: shipped builds don't get it.

## Policy

1. **Additive only** on anything iOS reads or sends. Keep the old field, endpoint and accepted request shape; add the new one beside it. A status or error code has no "beside": keep the old value and carry the new information in an added field. This needs no client detection, so it is the only rule that protects builds already shipped.
2. **Can't be additive: expand, don't replace.** A new field name, a new endpoint path or an opt-in request param carries the new contract. Web moves to it in the same PR; the old one keeps its exact behaviour. The client selects the contract by what it requests, not by who it claims to be.
3. **Client gating is the last resort**, for breaks a client cannot opt out of: a new enum value in an existing field, a changed behaviour rule (e.g. editability), a status or error code whose new value is the point. Never apply it without the user's decision. See "Identifying the client".
4. **Support window: the current and the previous iOS release.** Keep the old contract while either of them uses it. Retire it by raising `IOS_MIN_SUPPORTED_BUILD` to a build that no longer uses it; that build must itself send `x-app-build`.
5. **Pin what you keep.** When a field or endpoint stays alive only for iOS, assert it in that endpoint's e2e test, so a later cleanup fails loudly.

## Identifying the client

The app sends on every request:

- `x-app-platform: ios`;
- `x-app-build`: the release build number (a `yymmddHHMM` UTC timestamp, compares as an integer), or `dev` from Debug builds, treated as newest and never blocked;
- `expo-origin: moneymatter://`, for better-auth's `expo()` plugin (`moneymatter://`, `IOS_APP_ORIGIN` in `common/const/ios-app-origin.ts`, is in `trustedOrigins`, `config/auth.ts`). Web never sends it.

Builds shipped before `x-app-build` send only `expo-origin`: a legacy build, build unknown, oldest. Don't gate on `User-Agent`.

`middlewares/client-version-gate.ts`, mounted in `setup-routes.ts` after `/health` and ahead of every `/auth` handler:

- parses `x-app-build` into a number (1 to 15 digits), `dev`, or `null` for a legacy, missing or malformed build. Requests without either iOS header (web, webhooks) pass untouched. It stores nothing: a gate that needs the build later parses it the same way (or adds a field to `requestContext` then);
- when `IOS_MIN_SUPPORTED_BUILD` is set, answers `426` with code `CLIENT_UPDATE_REQUIRED` to a numeric build below it and to `null`. The app shows a blocking "update required" screen on `426`. Unset or empty means no gate, the default. A value that is not a build number blocks nothing and logs an error once per process.

Legacy builds can't render that screen. Once the minimum is set they get `426` on every call and just show errors, so set it only when retiring them on purpose.

## What breaks a shipped build

Response:

- a field removed, renamed, retyped, or made nullable/omitted when the Swift property is non-optional;
- a new value in an enum that Swift decodes strictly;
- envelope or pagination change: bare array to a wrapper object, `response` null or missing where an object is expected, a changed `status` string;
- a date that is not an ISO-8601 string; a number turned into a string (or back) outside the money decoders;
- a response header the app reads (`Set-Cookie`, `X-Total-Rows`).

Request:

- a newly required body field or query param, stricter validation of an existing one, a removed or renamed param the app sends;
- an endpoint removed, moved, or switched to another method.

Errors and status:

- a changed status code or `code` where a call site branches on it;
- a changed `details` shape or message text where a call site reads it;
- `GET /user` moved, or answering `401` for a live session: the app probes it after any `401`, and a `401` there signs the user out;
- a new gate (entitlement, rate limit, demo block) on an endpoint the app calls freely.

Auth and transport:

- anything in `config/auth.ts` that touches `/auth/*` routes, `trustedOrigins`, the `expo()` plugin or cookie names (the app matches the `session_token` and `.oauth_state` suffixes);
- the `202` ticket (`response.backgroundJobId`) or `GET /background-jobs/:id`: every background endpoint depends on them.

Behaviour: a rule the app mirrors in its UI (what is editable or deletable, required combinations, defaults, limits). The request then fails or does something else where the old build's UI promised otherwise.

Safe: new response fields, new endpoints, new optional request fields, looser validation.

## How to check a candidate

Read-only in both repos.

1. **Locate the iOS sources.** `IOS="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/../budget-tracker-ios"`. Read `main` through git, since the working tree may sit on a feature branch: `git -C "$IOS" grep -n '<pattern>' main -- MoneyMatterMobile` and `git -C "$IOS" show main:<path>`.
2. **Collect candidates** from the diff against `<base>`. Wire-facing code is:
   - `routes/` and `setup-routes.ts`;
   - controllers (the zod schema is the request contract; `statusCode`; `inBackground`);
   - `serializers/`, and models whose instances are returned without a serializer;
   - `packages/shared/src/types` (enums, response types, `API_ERROR_CODES`);
   - `js/errors.ts`, `controllers/helpers/`, `middlewares/`, `config/auth.ts`;
   - services where a thrown error, a validation or a business rule changed.
3. **Resolve each to `METHOD /path`**: the mount in `setup-routes.ts` plus the router path, without `/api/v1`. A changed model, enum or serializer maps to every endpoint that returns it.
4. **Grep iOS for the path's static segments**, not the full path or the call syntax: `budget-plans`, `planned-summary`. Paths are also held in constants (`static let path`, `let path = "/budget-plans/\(id)"`), composed (`"\(planPath)/accounts"`) and passed through local helpers (`fetch("/x")`, `optional("/vehicles", from: api)`), so follow each hit to the `api.get/post/...` call and the type it decodes. For a request change, grep the param too: `URLQueryItem(name: "x"` or the `Encodable` body struct.
5. **Read the `Decodable` type and decide.** `JSONDecoder` has no key strategy, so keys match exactly and unknown keys are ignored. Then:
   - a non-optional property that is missing, null or the wrong type fails the whole response, and for a list the whole list, unless the type has a custom `init(from:)` using `decodeIfPresent`/`try?` or sits behind a `Lossy` wrapper;
   - `enum X: String, Decodable` without a custom init rejects unknown values;
   - `decodeDecimal` accepts a string or a number; a plain `Decimal`/`Double`/`Int` property does not;
   - `getObject`/`postObject`/... throw on a null or missing `response`; `getList` turns it into `[]`.
6. **Read the call site's error handling**: `httpStatus ==`, `.code ==`, `.details`, `clientMessage` in the `catch`. Error bodies are read from `response.message|code|details`, and from flat `message|code` on `/auth/*`.
7. **For a behaviour rule, find where the app mirrors it.** Grep the model property the backend rule keys on (the field, not the endpoint) and read the view or view-model condition that offers the action. Rule tightened: old builds offer an action that now fails, so BREAKS. Rule loosened: old builds keep refusing what is now allowed, so SAFE, and say what they still block. Not mirrored and the endpoint's error is shown to the user: SAFE.
8. **`main` is newer than any shipped build.** If only tolerant decoding makes the change safe, or the field is unused, check whether that was always true: `git -C "$IOS" log --format='%h %cs %s' -S'<token>' main -- MoneyMatterMobile`. If the tolerance or the non-usage arrived in a later commit than the type or call site itself, builds from before that commit break: report SAFE ON MAIN ONLY with that commit's date.

## Reporting

One line per candidate, breaks first:

```
- **backend-file:line** `METHOD /path` — what changed. iOS: `file:line` (type or call site). **BREAKS** | **SAFE ON MAIN ONLY** (since <date>) | **SAFE** | **UNDETERMINED** — reason. Fix: <policy rule>.
```

No "might break": read the Swift code until the verdict is certain, and use UNDETERMINED only with the exact thing that could not be read. A change the app does not consume is SAFE with "no iOS usage" and the grep used.
