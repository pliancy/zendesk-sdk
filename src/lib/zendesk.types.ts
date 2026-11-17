export type ZendeskConfigBase = {
    subdomain: string
}

export type ZendeskBasicConfig = ZendeskConfigBase & {
    username: string
    password: string
}

export type ZendeskBearerConfig = ZendeskConfigBase & {
    getAccessToken: () => Promise<string>
}

export type ZendeskBearerStaticConfig = ZendeskConfigBase & {
    accessToken: string
    getAccessToken?: () => Promise<string>
}

export type ZendeskConfig = ZendeskBasicConfig | ZendeskBearerConfig | ZendeskBearerStaticConfig

export function resolveZendeskAuthMode(config: ZendeskConfig): 'basic' | 'bearer' {
    if ('getAccessToken' in config && config.getAccessToken != null) {
        return 'bearer'
    }
    if ('accessToken' in config && config.accessToken != null && config.accessToken !== '') {
        return 'bearer'
    }
    return 'basic'
}
