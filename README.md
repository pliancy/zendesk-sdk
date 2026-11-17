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
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  scope: 'read',
})

const users = await zendesk.users.search('email:you@example.com')
```

## Authentication

Zendesk is [removing API tokens as an authentication method for API requests](https://support.zendesk.com/hc/en-us/articles/10851263566234-Announcing-the-removal-of-API-tokens-as-an-authentication-method-for-API-requests). **Functional and security updates (including new API tokens) for third-party integrations must migrate to OAuth by April 30, 2027.** New integrations should use OAuth client credentials. Basic API token auth remains supported in this SDK for backward compatibility during migration.

### Basic (API token) — legacy / transitional

```typescript
new Zendesk({
  subdomain: 'your-subdomain',
  username: 'you@example.com/token', // `{email}/token`
  password: 'your-api-token',
})
```

The SDK sends `Authorization: Basic …` on each request.

### OAuth (client credentials) — recommended

Pass the OAuth client id, client secret, and scope. The SDK requests an access token with the [client credentials flow](https://developer.zendesk.com/documentation/authentication/api-tokens-to-oauth/) and sends `Authorization: Bearer …` on each API request.

```typescript
new Zendesk({
  subdomain: 'your-subdomain',
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
  scope: 'read', // or a space-separated list, e.g. 'tickets:read users:read'
})
```

`scope` is required by Zendesk. Keep the client secret on the server. This flow does not use a user redirect or a refresh token: the SDK caches the access token and requests a new one when it expires, or when Zendesk rejects it with a 401 `invalid_token` error (the failed request is retried once). Token requests time out after 10 seconds, and token failures are thrown as `AxiosError`s that keep the HTTP status. OAuth fields that are `undefined` or empty are ignored, so Basic auth still works if they are left blank. The token inherits the permissions of the user who owns the OAuth client.

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