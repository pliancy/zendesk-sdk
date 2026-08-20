export interface UserIdentity {
    id?: number
    url?: string
    user_id?: number
    type: 'email' | 'twitter' | 'facebook' | 'google' | 'phone_number' | 'agent_forwarding' | 'sdk'
    value: string
    verified?: boolean
    primary?: boolean
    /** Write-only. Suppresses the verification email Zendesk would otherwise send on create. */
    skip_verify_email?: boolean
    deliverable_state?: 'deliverable' | 'undeliverable'
    undeliverable_count?: number
    created_at?: string
    updated_at?: string
}
