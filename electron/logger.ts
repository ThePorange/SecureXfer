import fs from 'fs'
import path from 'path'
import { app } from 'electron'

class Logger {
    private logPath: string

    constructor() {
        // Use a persistent path in the user data folder
        const userDataPath = app.getPath('userData')
        this.logPath = path.join(userDataPath, 'debug.log')

        // Clear log on startup
        try {
            if (fs.existsSync(this.logPath)) {
                fs.unlinkSync(this.logPath)
            }
        } catch (err) {
            console.error('Failed to clear log file:', err)
        }
    }

    private formatMessage(level: string, message: string, ...args: any[]): string {
        const timestamp = new Date().toISOString()
        let formattedMessage = `[${timestamp}] [${level}] ${message}`
        if (args.length > 0) {
            formattedMessage += ' ' + args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
            ).join(' ')
        }
        return formattedMessage
    }

    public info(message: string, ...args: any[]) {
        const formatted = this.formatMessage('INFO', message, ...args)
        console.log(formatted)
        this.writeToFile(formatted)
    }

    public error(message: string, ...args: any[]) {
        const formatted = this.formatMessage('ERROR', message, ...args)
        console.error(formatted)
        this.writeToFile(formatted)
    }

    public warn(message: string, ...args: any[]) {
        const formatted = this.formatMessage('WARN', message, ...args)
        console.warn(formatted)
        this.writeToFile(formatted)
    }

    private writeToFile(message: string) {
        try {
            fs.appendFileSync(this.logPath, message + '\n')
        } catch (err) {
            console.error('Failed to write to log file:', err)
        }
    }

    public getLogPath(): string {
        return this.logPath
    }
}

export const logger = new Logger()
