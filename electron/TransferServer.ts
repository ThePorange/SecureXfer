import express from 'express'
import { Server as SocketServer } from 'socket.io'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'

export interface TransferRequest {
    id: string
    senderName: string
    fileName: string
    fileSize: number
    fileType: string
    ip: string
    fileCount?: number
    totalSize?: number
}

export class TransferServer {
    private expressApp = express()
    private server: https.Server
    private io: SocketServer
    private port: number = 0
    private win: BrowserWindow | null = null
    private activeDecisions: Map<string, (allowed: boolean) => void> = new Map()

    constructor(key: string, cert: string) {
        this.server = https.createServer({ key, cert }, this.expressApp)
        this.io = new SocketServer(this.server, {
            cors: { origin: '*' }
        })
        this.setupRoutes()
        this.setupSockets()
    }

    public setWindow(win: BrowserWindow) {
        this.win = win
    }

    private setupRoutes() {
        this.expressApp.use(express.json())

        this.expressApp.post('/upload', (req, res) => {
            const rawFileName = req.query.filename as string
            const transferId = req.query.id as string
            const totalSize = parseInt(req.query.size as string || '0')
            let receivedSize = 0

            // Ensure we don't allow path traversal but allow internal subdirs
            const downloadsPath = app.getPath('downloads')
            const savePath = path.join(downloadsPath, rawFileName)

            // Ensure parent directory exists
            const parentDir = path.dirname(savePath)
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true })
            }

            console.log('Incoming upload:', {
                rawFileName,
                downloadsPath,
                savePath,
                transferId,
                totalSize
            })

            const writeStream = fs.createWriteStream(savePath)

            req.on('data', (chunk) => {
                receivedSize += chunk.length
                if (totalSize > 0) {
                    const progress = Math.round((receivedSize / totalSize) * 100)
                    this.win?.webContents.send('transfer-status', { id: transferId, status: 'progress', progress })
                }
            })

            req.pipe(writeStream)

            writeStream.on('finish', () => {
                console.log(`Successfully saved file to: ${savePath}`)
                res.status(200).send({ message: 'Success' })
                this.win?.webContents.send('transfer-status', { id: transferId, status: 'completed', path: savePath })
            })

            writeStream.on('error', (err) => {
                res.status(500).send({ error: err.message })
                this.win?.webContents.send('transfer-status', { id: transferId, status: 'error', message: err.message })
            })
        })
    }

    private setupSockets() {
        this.io.on('connection', (socket) => {
            let pendingTransferId: string | null = null

            socket.on('request-transfer', (data: TransferRequest) => {
                pendingTransferId = data.id
                this.win?.webContents.send('incoming-transfer', data)
                this.activeDecisions.set(data.id, (allowed) => {
                    socket.emit('transfer-decision', { id: data.id, allowed })
                    pendingTransferId = null
                    if (!allowed) this.activeDecisions.delete(data.id)
                })
            })

            socket.on('cancel-transfer', (data: { id: string }) => {
                if (this.activeDecisions.has(data.id)) {
                    this.activeDecisions.delete(data.id)
                    this.win?.webContents.send('cancel-transfer', data)
                    pendingTransferId = null
                }
            })

            socket.on('disconnect', () => {
                if (pendingTransferId && this.activeDecisions.has(pendingTransferId)) {
                    this.activeDecisions.delete(pendingTransferId)
                    this.win?.webContents.send('cancel-transfer', { id: pendingTransferId })
                }
            })
        })
    }

    public handleDecision(transferId: string, allowed: boolean) {
        const cb = this.activeDecisions.get(transferId)
        if (cb) {
            cb(allowed)
            this.activeDecisions.delete(transferId)
        }
    }

    public async start(): Promise<number> {
        return new Promise((resolve) => {
            this.server.listen(0, '0.0.0.0', () => {
                const addr = this.server.address()
                if (typeof addr === 'object' && addr !== null) {
                    this.port = addr.port
                    resolve(this.port)
                }
            })
        })
    }

    public getPort() {
        return this.port
    }
}
