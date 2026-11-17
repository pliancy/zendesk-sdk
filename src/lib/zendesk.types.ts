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

function hasOAuthCredentials(config: ZendeskConfig): config is ZendeskOAuthConfig {
    return (
        'clientId' in config &&
        'clientSecret' in config &&
        'scope' in config &&
        config.clientId !== '' &&
        config.clientSecret !== '' &&
        config.scope !== ''
    )
}

export function resolveZendeskAuthMode(config: ZendeskConfig): 'basic' | 'bearer' {
    if (hasOAuthCredentials(config)) {
        return 'bearer'
    }
    return 'basic'
}
