# @pliancy/zendesk-sdk

Promise-based wrapper for the [Zendesk Support API](https://developer.zendesk.com/api-reference/) (`/api/v2`) with TypeScript types.

## Install

```bash
yarn add @pliancy/zendesk-sdk
```

## Quick start

```typescript
import { Zendesk } from '@pliancy/zendesk-sdk'

const zendesk = new Zendesk({
  subdomain: 'your-subdomain',
  username: 'you@example.com/token',
  password: 'your-api-token',
})

const users = await zendesk.users.search('email:you@example.com')
```

## Authentication

Zendesk is [removing API tokens as an authentication method for API requests](https://support.zendesk.com/hc/en-us/articles/10851263566234-Announcing-the-removal-of-API-tokens-as-an-authentication-method-for-API-requests). **Functional and security updates (including new API tokens) for third-party integrations must migrate to OAuth by April 30, 2027.** New integrations should use OAuth Bearer; Basic API token auth remains supported in this SDK for backward compatibility during migration.

### Basic (API token) — legacy / transitional

```typescript
new Zendesk({
  subdomain: 'your-subdomain',
  username: 'you@example.com/token', // `{email}/token`
  password: 'your-api-token',
})
```

The SDK sends `Authorization: Basic …` on each request.

### Bearer (OAuth) — recommended

The SDK does **not** call `POST /oauth/tokens`. Your application mints and caches access tokens (for example [client credentials](https://developer.zendesk.com/documentation/authentication/api-tokens-to-oauth/)) and supplies them to the SDK:

```typescript
new Zendesk({
  subdomain: 'your-subdomain',
  getAccessToken: () => tokenProvider.getAccessToken(),
})
```

For tests or short-lived scripts you can pass a static token:

```typescript
new Zendesk({
  subdomain: 'your-subdomain',
  accessToken: 'oauth-access-token',
})
```

When `getAccessToken` is provided, it is invoked before each API request and the SDK sends `Authorization: Bearer …`.

## API modules

The `Zendesk` client exposes resource helpers including:

- `brands`, `groupMemberships`, `groups`, `organizationMemberships`, `organizations`
- `supportAddresses`, `ticketFields`, `triggers`, `userIdentities`, `users`, `views`

Tickets, comments, and some other endpoints are not covered yet; callers can use the Zendesk REST API directly alongside this SDK.

## Development

```bash
yarn install
yarn qa
```

This project uses [Volta](https://volta.sh/) for Node and Yarn versions (see `package.json`).