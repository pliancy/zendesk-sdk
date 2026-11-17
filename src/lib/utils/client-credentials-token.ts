import axios from 'axios'
import { ZendeskOAuthConfig } from '../zendesk.types'

const EXPIRY_SKEW_MS = 60 * 1000

type ZendeskTokenResponse = {
    access_token?: string
    expires_in?: number
}

type CachedAccessToken = {
    accessToken: string
    expiresAt: number
}

export type ClientCredentialsTokenSource = {
    getAccessToken: () => Promise<string>
    invalidate: () => void
}

export function createClientCredentialsTokenSource(
    config: ZendeskOAuthConfig,
): ClientCredentialsTokenSource {
    let cached: CachedAccessToken | undefined
    let inflight: Promise<string> | undefined

    const getAccessToken = (): Promise<string> => {
        const now = Date.now()
        if (cached && cached.expiresAt > now) {
            return Promise.resolve(cached.accessToken)
        }
        if (inflight) {
            return inflight
        }

        const request = fetchClientCredentialsToken(config, now)
            .then((token) => {
                cached = token
                return token.accessToken
            })
            .finally(() => {
                if (inflight === request) {
                    inflight = undefined
                }
            })
        inflight = request
        return request
    }

    return {
        getAccessToken,
        invalidate: () => {
            cached = undefined
        },
    }
}

async function fetchClientCredentialsToken(
    config: ZendeskOAuthConfig,
    now: number,
): Promise<CachedAccessToken> {
    let data: ZendeskTokenResponse
    try {
        const response = await axios.post<ZendeskTokenResponse>(
            `https://${config.subdomain}.zendesk.com/oauth/tokens`,
            {
                grant_type: 'client_credentials',
                client_id: config.clientId,
                client_secret: config.clientSecret,
                scope: config.scope,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
            },
        )
        data = response.data ?? {}
    } catch (error) {
        throw new Error(tokenFailureMessage(error))
    }

    if (typeof data.access_token !== 'string' || data.access_token === '') {
        throw new Error('Zendesk token response did not include an access_token')
    }

    const expiresInSeconds = typeof data.expires_in === 'number' ? data.expires_in : 0
    return {
        accessToken: data.access_token,
        expiresAt: now + Math.max(0, expiresInSeconds * 1000 - EXPIRY_SKEW_MS),
    }
}

function tokenFailureMessage(error: unknown): string {
    const prefix = 'Failed to obtain Zendesk access token'
    if (axios.isAxiosError(error)) {
        const detail = readZendeskOAuthError(error.response?.data)
        if (detail) {
            return `${prefix}: ${detail}`
        }
        if (error.response?.status) {
            return `${prefix}: HTTP ${error.response.status}`
        }
    }
    if (error instanceof Error && error.message) {
        return `${prefix}: ${error.message}`
    }
    return prefix
}

function readZendeskOAuthError(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
        return undefined
    }
    const body = data as { error?: unknown; error_description?: unknown }
    const code = typeof body.error === 'string' ? body.error : undefined
    const description =
        typeof body.error_description === 'string' ? body.error_description : undefined
    if (code && description) {
        return `${code}: ${description}`
    }
    return description ?? code
}
