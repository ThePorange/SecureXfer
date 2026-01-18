import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import https from 'node:https'
import crypto from 'node:crypto'
import selfsigned from 'selfsigned'

// Robust Electron API Resolution
let electron: any;
try {
    const e = require('electron');
    // If it's a string, it's the npm package path shim
    if (typeof e === 'string') {
        // Try to get it again, maybe it's available via a different require or global
        electron = (global as any).require ? (global as any).require('electron') : e;
        // If still a string, we might be in trouble, but let's try to see if we can get common objects
        if (typeof electron === 'string') {
            // Last ditch effort: try to see if we can get it from the internal modules if we were to name it differently
            // But usually, if we are in this state, we just have to hope the next calls work or we are in a weird node mode
            electron = {};
        }
    } else {
        electron = e;
    }
} catch (err) {
    electron = {};
}

const { app, BrowserWindow, ipcMain, dialog, shell } = electron;

import { MDNSService } from './MDNSService'
import { TransferServer } from './TransferServer'

// Disable hardware acceleration and ignore certificate errors
if (app) {
    try {
        app.disableHardwareAcceleration()
        app.commandLine.appendSwitch('ignore-certificate-errors')
        app.commandLine.appendSwitch('allow-insecure-localhost', 'true')
    } catch (e) {
        console.error('Failed to configure app:', e)
    }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = app ? app.getAppPath() : path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT as string, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT as string, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT as string, 'public') : RENDERER_DIST

let win: any | null = null
let mdnsService: MDNSService
let transferServer: TransferServer
let myFingerprint: string
let myKeys: { key: string, cert: string }

async function generateCerts() {
    try {
        const attrs = [{ name: 'commonName', value: 'securexfer.local' }]
        const pems: any = await (selfsigned as any).generate(attrs, { days: 365, keySize: 2048 })
        const certHash = crypto.createHash('sha256').update(pems.cert).digest('hex').toUpperCase()
        myKeys = { key: pems.private, cert: pems.cert }
        myFingerprint = certHash
    } catch (err: any) {
        console.error('Failed to generate certificates:', err)
        if (dialog) dialog.showErrorBox('Certificate Error', `Failed to generate secure certificates: ${err.message}`)
        throw err
    }
}

async function createWindow() {
    if (!app || !BrowserWindow) {
        console.error('Cannot create window: app or BrowserWindow is missing');
        return;
    }

    try {
        await generateCerts()

        const iconPath = path.join(process.env.VITE_PUBLIC || '', 'logo.png')

        win = new (BrowserWindow as any)({
            icon: iconPath,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
            },
            width: 1100,
            height: 800,
            minWidth: 900,
            minHeight: 600,
            titleBarStyle: 'hidden',
            titleBarOverlay: {
                color: '#0f172a',
                symbolColor: '#f8fafc'
            }
        })

        transferServer = new TransferServer(myKeys.key, myKeys.cert)
        transferServer.setWindow(win)
        const port = await transferServer.start()
        mdnsService = new MDNSService(port, myFingerprint)

        setInterval(() => {
            mdnsService.discover()
            win?.webContents.send('peer-list', mdnsService.getPeers())
        }, 3000)

        if (VITE_DEV_SERVER_URL) {
            win.loadURL(VITE_DEV_SERVER_URL).catch((err: any) => {
                const fallback = path.join(RENDERER_DIST, 'index.html')
                win?.loadFile(fallback)
            })
        } else {
            const appRoot = process.env.APP_ROOT || app.getAppPath()
            const indexPath = [
                path.join(appRoot, 'dist', 'index.html'),
                path.join(appRoot, 'index.html')
            ].find(p => fs.existsSync(p)) || path.join(appRoot, 'index.html')

            win.loadFile(indexPath)
        }
    } catch (err: any) {
        if (dialog) dialog.showErrorBox('Startup Error', `The application failed to start: ${err.message}`)
    }
}

if (app) {
    app.on('certificate-error', (event: any, _webContents: any, _url: any, _error: any, _certificate: any, callback: any) => {
        event.preventDefault()
        callback(true)
    })

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit()
        }
    })

    app.on('activate', () => {
        if (BrowserWindow && BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })

    app.whenReady().then(createWindow).catch((e: any) => console.error('App ready failed:', e))
} else {
    console.error('Electron app object not found. This process may be running in Node mode instead of Electron mode.');
}

function processPaths(paths: string[]) {
    const allFiles: any[] = []

    paths.forEach(p => {
        if (!fs.existsSync(p)) return
        const stats = fs.statSync(p)
        if (stats.isDirectory()) {
            getAllFiles(p, allFiles, path.dirname(p))
        } else {
            allFiles.push({
                path: p,
                name: path.basename(p),
                size: stats.size,
                relativePath: path.basename(p) // Root file
            })
        }
    })

    return allFiles
}

function getAllFiles(dirPath: string, arrayOfFiles: any[] = [], baseDir: string = "") {
    const files = fs.readdirSync(dirPath)
    baseDir = baseDir || path.dirname(dirPath)

    files.forEach((file) => {
        const fullPath = path.join(dirPath, file)
        const stats = fs.statSync(fullPath)
        if (stats.isDirectory()) {
            getAllFiles(fullPath, arrayOfFiles, baseDir)
        } else {
            arrayOfFiles.push({
                path: fullPath,
                name: path.basename(fullPath),
                size: stats.size,
                relativePath: path.relative(baseDir, fullPath)
            })
        }
    })

    return arrayOfFiles
}

if (ipcMain) {
    ipcMain.handle('show-item-in-folder', (_: any, fullPath: string) => {
        if (shell) shell.showItemInFolder(fullPath)
    })

    ipcMain.handle('select-files', async () => {
        if (!dialog) return []
        const result = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections']
        })
        if (result.canceled || result.filePaths.length === 0) return []
        return processPaths(result.filePaths)
    })

    ipcMain.handle('select-folder', async () => {
        if (!dialog) return []
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        })
        if (result.canceled || result.filePaths.length === 0) return []
        return processPaths(result.filePaths)
    })

    ipcMain.handle('process-dropped-paths', async (_: any, paths: string[]) => {
        return processPaths(paths)
    })

    ipcMain.on('transfer-decision', (_: any, { id, allowed }: any) => {
        if (transferServer) transferServer.handleDecision(id, allowed)
    })

    ipcMain.handle('start-upload', async (_: any, { targetIp, targetPort, filePath, transferId, expectedFingerprint, relativePath }: any) => {
        const fileName = relativePath || path.basename(filePath)
        const stats = fs.statSync(filePath)
        const totalSize = stats.size
        let uploadedSize = 0

        const fileStream = fs.createReadStream(filePath)

        fileStream.on('data', (chunk) => {
            uploadedSize += chunk.length
            const progress = Math.round((uploadedSize / totalSize) * 100)
            win?.webContents.send('transfer-status', { id: transferId, status: 'progress', progress })
        })

        const agent = new https.Agent({
            rejectUnauthorized: false,
            checkServerIdentity: (_hostname, cert) => {
                const serverFp = crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase()
                if (serverFp !== expectedFingerprint) {
                    return new Error('Fingerprint mismatch!')
                }
                return undefined
            }
        })

        try {
            await axios.post(`https://${targetIp}:${targetPort}/upload`, fileStream, {
                params: { filename: fileName, id: transferId, size: totalSize },
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': totalSize
                },
                httpsAgent: agent,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            })
            return { success: true }
        } catch (err: any) {
            console.error('Upload failed:', err)
            throw new Error(err.message)
        }
    })
}
