export type ZendeskConfigBase = {
    subdomain: string
}

export type ZendeskBasicConfig = ZendeskConfigBase & {
    username: string
    password: string
}

export type ZendeskOAuthConfig = ZendeskConfigBase & {
    clientId: string
    clientSecret: string
    scope: string
}

export type ZendeskConfig = ZendeskBasicConfig | ZendeskOAuthConfig

export type ZendeskAuth =
    | { mode: 'basic'; config: ZendeskBasicConfig }
    | { mode: 'bearer'; config: ZendeskOAuthConfig }

export const INVALID_CONFIG_MESSAGE =
    'ZendeskConfig must provide clientId, clientSecret, and scope, or both username and password for Basic auth'

export const OAUTH_FIELDS_MESSAGE =
    'ZendeskConfig client credentials require clientId, clientSecret, and scope'

function isSet(value: unknown): value is string {
    return typeof value === 'string' && value !== ''
}

/**
 * Determines which auth method a config uses. Fields that are undefined or empty
 * strings are treated as absent. Throws when the config is incomplete.
 */
export function resolveZendeskAuth(config: ZendeskConfig): ZendeskAuth {
    const fields = config as Partial<ZendeskBasicConfig & ZendeskOAuthConfig>
    const oauthFields = [fields.clientId, fields.clientSecret, fields.scope]
    const oauthSetCount = oauthFields.filter(isSet).length

    if (oauthSetCount === oauthFields.length) {
        return { mode: 'bearer', config: config as ZendeskOAuthConfig }
    }
    if (oauthSetCount > 0) {
        throw new Error(OAUTH_FIELDS_MESSAGE)
    }
    if (isSet(fields.username) && isSet(fields.password)) {
        return { mode: 'basic', config: config as ZendeskBasicConfig }
    }
    throw new Error(INVALID_CONFIG_MESSAGE)
}

export function resolveZendeskAuthMode(config: ZendeskConfig): ZendeskAuth['mode'] {
    return resolveZendeskAuth(config).mode
}
