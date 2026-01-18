import { describe, it, expect } from 'vitest'

// Simple implementation to test (or we could export it from App.tsx but it's currently inside the component)
// For unit tests, it's best to have these in a separate utils file.
function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

describe('formatBytes', () => {
    it('formats 0 bytes correctly', () => {
        expect(formatBytes(0)).toBe('0 Bytes')
    })

    it('formats KB correctly', () => {
        expect(formatBytes(1024)).toBe('1 KB')
    })

    it('formats MB correctly', () => {
        expect(formatBytes(1024 * 1024)).toBe('1 MB')
    })

    it('formats with custom decimals', () => {
        expect(formatBytes(1500, 1)).toBe('1.5 KB')
    })

    it('handles GB scale', () => {
        expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe('2 GB')
    })
})
