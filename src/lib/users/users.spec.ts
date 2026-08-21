import mockAxios from 'jest-mock-axios'
import { AxiosInstance } from 'axios'
import { Users } from './users'
import { User } from './users.types'

describe('Users', () => {
    let users: Users

    const mockUser: User = { id: 1, name: 'Jane Doe', email: 'jane@example.com', role: 'end-user' }
    const mockUser2: User = { id: 2, name: 'John Doe', email: 'john@example.com', role: 'end-user' }

    beforeEach(() => {
        mockAxios.reset()
        users = new Users(mockAxios as never as AxiosInstance)
    })

    it('creates the instance', () => expect(users).toBeTruthy())

    describe('createOrUpdate', () => {
        it('upserts a user', async () => {
            jest.spyOn(mockAxios, 'post').mockResolvedValue({ data: { user: mockUser } })
            await expect(
                users.createOrUpdate({ name: 'Jane Doe', email: 'jane@example.com' }),
            ).resolves.toEqual(mockUser)
            expect(mockAxios.post).toHaveBeenCalledWith('/users/create_or_update.json', {
                user: { name: 'Jane Doe', email: 'jane@example.com' },
            })
        })

        it('sends skip_verify_email as a top-level body field', async () => {
            jest.spyOn(mockAxios, 'post').mockResolvedValue({ data: { user: mockUser } })

            await expect(
                users.createOrUpdate({
                    name: 'Jane Doe',
                    email: 'jane@example.com',
                    verified: true,
                    skip_verify_email: true,
                }),
            ).resolves.toEqual(mockUser)
            expect(mockAxios.post).toHaveBeenCalledWith('/users/create_or_update.json', {
                user: { name: 'Jane Doe', email: 'jane@example.com', verified: true },
                skip_verify_email: true,
            })
        })
    })

    describe('update', () => {
        it('updates a user', async () => {
            const updated: User = { ...mockUser, name: 'Jane Smith' }
            jest.spyOn(mockAxios, 'put').mockResolvedValue({ data: { user: updated } })
            await expect(users.update(1, { name: 'Jane Smith' })).resolves.toEqual(updated)
            expect(mockAxios.put).toHaveBeenCalledWith('/users/1.json', {
                user: { name: 'Jane Smith' },
            })
        })
    })

    describe('search', () => {
        it('searches users by query (single page)', async () => {
            jest.spyOn(mockAxios, 'get').mockResolvedValue({
                data: { users: [mockUser], next_page: null },
            })
            await expect(users.search('email:jane@example.com')).resolves.toEqual([mockUser])
            expect(mockAxios.get).toHaveBeenCalledWith('/users/search.json', {
                params: { query: 'email:jane@example.com' },
            })
        })

        it('paginates through multiple pages', async () => {
            jest.spyOn(mockAxios, 'get')
                .mockResolvedValueOnce({
                    data: { users: [mockUser], next_page: '/users/search.json?page=2' },
                })
                .mockResolvedValueOnce({
                    data: { users: [mockUser2], next_page: null },
                })
            await expect(users.search('role:end-user')).resolves.toEqual([mockUser, mockUser2])
        })
    })

    describe('suspend', () => {
        it('suspends a user', async () => {
            const suspended: User = { ...mockUser, suspended: true }
            jest.spyOn(mockAxios, 'put').mockResolvedValue({ data: { user: suspended } })
            await expect(users.suspend(1)).resolves.toEqual(suspended)
            expect(mockAxios.put).toHaveBeenCalledWith('/users/1.json', {
                user: { suspended: true },
            })
        })
    })

    describe('unsuspend', () => {
        it('unsuspends a user', async () => {
            const active: User = { ...mockUser, suspended: false }
            jest.spyOn(mockAxios, 'put').mockResolvedValue({ data: { user: active } })
            await expect(users.unsuspend(1)).resolves.toEqual(active)
            expect(mockAxios.put).toHaveBeenCalledWith('/users/1.json', {
                user: { suspended: false },
            })
        })
    })

    describe('delete', () => {
        it('soft deletes a user', async () => {
            jest.spyOn(mockAxios, 'delete').mockResolvedValue({})
            await expect(users.delete(1)).resolves.toBeUndefined()
            expect(mockAxios.delete).toHaveBeenCalledWith('/users/1.json')
        })
    })

    describe('permanentlyDelete', () => {
        it('hard deletes a user', async () => {
            jest.spyOn(mockAxios, 'delete').mockResolvedValue({})
            await expect(users.permanentlyDelete(1)).resolves.toBeUndefined()
            expect(mockAxios.delete).toHaveBeenCalledWith('/deleted_users/1.json')
        })
    })
})
