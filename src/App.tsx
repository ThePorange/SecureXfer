import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { io, Socket } from 'socket.io-client'
import logo from './assets/logo.png'
import pkg from '../package.json'

interface Peer {
    id: string
    name: string
    ip: string
    port: number
    fingerprint: string
}

interface SelectedFile {
    path: string
    name: string
    size: number
    relativePath?: string
}

interface TransferRequest {
    id: string
    senderName: string
    fileName: string
    fileSize: number
    fileType: string
    fileCount?: number
    totalSize?: number
}

interface TransferActivity {
    id: string
    name: string
    type: 'sending' | 'receiving'
    status: string
    progress: number
    totalSize: number
    fileCount: number
    isCompleted: boolean
    error?: string
    savePath?: string
    startTime: number
}

function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

export default function App() {
    const [peers, setPeers] = useState<Peer[]>([])
    const [selectedPeer, setSelectedPeer] = useState<Peer | null>(null)
    const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
    const [incomingTransfer, setIncomingTransfer] = useState<TransferRequest | null>(null)
    const [activities, setActivities] = useState<Record<string, TransferActivity>>({})
    const [isDragging, setIsDragging] = useState(false)


    useEffect(() => {
        const handlePeerList = (_event: any, list: Peer[]) => setPeers(list)
        const handleIncomingTransfer = (_event: any, request: TransferRequest) => setIncomingTransfer(request)
        const handleStatusUpdate = (_event: any, update: { id: string, status: string, message?: string, path?: string, progress?: number }) => {
            setActivities(prev => {
                const activity = prev[update.id]
                if (!activity) return prev

                const updated = { ...activity }
                if (update.status === 'progress') {
                    updated.progress = update.progress || 0
                    updated.status = activity.type === 'sending' ? 'Uploading...' : 'Downloading...'
                } else if (update.status === 'completed') {
                    updated.isCompleted = true
                    updated.progress = 100
                    updated.savePath = update.path
                    const duration = ((Date.now() - activity.startTime) / 1000).toFixed(1)
                    updated.status = `Completed in ${duration}s`
                } else if (update.status === 'error') {
                    updated.status = 'Error'
                    updated.error = update.message
                }
                return { ...prev, [update.id]: updated }
            })
        }

        const handleCancelTransfer = (_event: any, data: { id: string }) => {
            setIncomingTransfer(prev => prev?.id === data.id ? null : prev)
        }

        window.ipcRenderer.on('peer-list', handlePeerList)
        window.ipcRenderer.on('incoming-transfer', handleIncomingTransfer)
        window.ipcRenderer.on('transfer-status', handleStatusUpdate)
        window.ipcRenderer.on('cancel-transfer', handleCancelTransfer)

        return () => {
            window.ipcRenderer.off('peer-list', handlePeerList)
            window.ipcRenderer.off('incoming-transfer', handleIncomingTransfer)
            window.ipcRenderer.off('transfer-status', handleStatusUpdate)
            window.ipcRenderer.off('cancel-transfer', handleCancelTransfer)
        }
    }, [])

    const handleSelectFiles = async () => {
        const files: SelectedFile[] = await window.ipcRenderer.invoke('select-files')
        if (files && files.length > 0) {
            setSelectedFiles(prev => [...prev, ...files])
        }
    }

    const handleSelectFolder = async () => {
        const files: SelectedFile[] = await window.ipcRenderer.invoke('select-folder')
        if (files && files.length > 0) {
            const totalSize = files.reduce((acc, f) => acc + f.size, 0)
            if (totalSize > 1024 * 1024 * 1024) {
                const confirmLarge = window.confirm(`This folder is quite large (${formatBytes(totalSize)}). Do you want to continue?`)
                if (!confirmLarge) return
            }
            setSelectedFiles(prev => [...prev, ...files])
        }
    }

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const paths = Array.from(e.dataTransfer.files)
            .map(f => (f as any).path)
            .filter(p => p) // Ensure we have paths

        if (paths.length > 0) {
            const files: SelectedFile[] = await window.ipcRenderer.invoke('process-dropped-paths', paths)
            const totalSize = files.reduce((acc, f) => acc + f.size, 0)
            if (totalSize > 1024 * 1024 * 1024) {
                const confirmLarge = window.confirm(`This transfer is quite large (${formatBytes(totalSize)}). Do you want to continue?`)
                if (!confirmLarge) return
            }
            setSelectedFiles(prev => [...prev, ...files])
        }
    }

    const handleSendClipboard = async () => {
        const file: SelectedFile | null = await window.ipcRenderer.invoke('get-clipboard-content')
        if (file) {
            setSelectedFiles(prev => [...prev, file])
        } else {
            alert('Clipboard is empty or contains unsupported format (plain text or images only).')
        }
    }

    const handleSend = async () => {
        if (!selectedPeer || selectedFiles.length === 0) return

        const socket: Socket = io(`https://${selectedPeer.ip}:${selectedPeer.port}`, {
            rejectUnauthorized: false
        })

        const transferId = crypto.randomUUID()
        const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0)
        const fileCount = selectedFiles.length
        const fileName = selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} items`

        // Add to activities
        setActivities(prev => ({
            ...prev,
            [transferId]: {
                id: transferId,
                name: fileName,
                type: 'sending',
                status: 'Connecting...',
                progress: 0,
                totalSize,
                fileCount,
                isCompleted: false,
                startTime: Date.now()
            }
        }))

        socket.emit('request-transfer', {
            id: transferId,
            senderName: 'Sender',
            fileName,
            fileSize: totalSize,
            fileType: '',
            ip: '',
            fileCount,
            totalSize
        })

        setActivities(prev => ({
            ...prev,
            [transferId]: { ...prev[transferId], status: 'Waiting for permission...' }
        }))

        const timeoutId = setTimeout(() => {
            setActivities(prev => ({
                ...prev,
                [transferId]: { ...prev[transferId], status: 'Timed out', error: 'Recipient did not respond.' }
            }))
            socket.emit('cancel-transfer', { id: transferId })
            setTimeout(() => socket.disconnect(), 100)
        }, 30000)

        socket.on('transfer-decision', async (data: { id: string, allowed: boolean }) => {
            clearTimeout(timeoutId)
            if (data.allowed) {
                setActivities(prev => ({
                    ...prev,
                    [transferId]: { ...prev[transferId], status: 'Uploading...' }
                }))
                try {
                    const startTime = Date.now()
                    let totalUploaded = 0

                    for (const file of selectedFiles) {
                        setActivities(prev => ({
                            ...prev,
                            [transferId]: { ...prev[transferId], status: `Uploading: ${file.name}...` }
                        }))
                        await window.ipcRenderer.invoke('start-upload', {
                            targetIp: selectedPeer.ip,
                            targetPort: selectedPeer.port,
                            filePath: file.path,
                            transferId,
                            expectedFingerprint: selectedPeer.fingerprint,
                            relativePath: file.relativePath
                        })
                        totalUploaded += file.size
                        const overallProgress = Math.round((totalUploaded / totalSize) * 100)
                        setActivities(prev => ({
                            ...prev,
                            [transferId]: { ...prev[transferId], progress: overallProgress }
                        }))
                    }

                    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
                    setActivities(prev => ({
                        ...prev,
                        [transferId]: {
                            ...prev[transferId],
                            status: `Success! Sent in ${duration}s`,
                            isCompleted: true,
                            progress: 100
                        }
                    }))
                    setSelectedFiles([])
                } catch (err: any) {
                    setActivities(prev => ({
                        ...prev,
                        [transferId]: { ...prev[transferId], status: 'Error', error: err.message }
                    }))
                }
            } else {
                setActivities(prev => ({
                    ...prev,
                    [transferId]: { ...prev[transferId], status: 'Denied by recipient' }
                }))
            }
            socket.disconnect()
        })
    }

    const handleDecision = (allowed: boolean) => {
        if (incomingTransfer) {
            const transferId = incomingTransfer.id
            if (allowed) {
                setActivities(prev => ({
                    ...prev,
                    [transferId]: {
                        id: transferId,
                        name: incomingTransfer.fileName,
                        type: 'receiving',
                        status: 'Downloading...',
                        progress: 0,
                        totalSize: incomingTransfer.totalSize || incomingTransfer.fileSize,
                        fileCount: incomingTransfer.fileCount || 1,
                        isCompleted: false,
                        startTime: Date.now()
                    }
                }))
            }
            window.ipcRenderer.send('transfer-decision', { id: transferId, allowed })
            setIncomingTransfer(null)
        }
    }

    return (
        <div className="app-container">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-content">
                    <div className="title-bar">SECUREXFER</div>

                    <div className="logo-container">
                        <img src={logo} className="logo-img" alt="Logo" />
                        <span className="logo-text">SecureXfer</span>
                    </div>

                    <div className="px-6 mb-4">
                        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Available Devices</h2>
                    </div>

                    <div className="peer-list custom-scrollbar">
                        {peers.length === 0 ? (
                            <div className="px-6 py-4 text-sm text-slate-500 italic">
                                Searching for devices...
                            </div>
                        ) : (
                            peers.map(peer => (
                                <div
                                    key={peer.id}
                                    onClick={() => setSelectedPeer(peer)}
                                    className={`peer-card ${selectedPeer?.id === peer.id ? 'selected' : ''}`}
                                >
                                    <div className="peer-icon">
                                        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <div className="text-sm font-semibold truncate">{peer.name}</div>
                                        <div className="text-xs text-slate-500 truncate">{peer.ip}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content p-12">
                <div className="max-w-3xl mx-auto w-full">
                    <header className="mb-12">
                        <h1 className="text-4xl font-extrabold mb-2 text-white">Share Files</h1>
                        <p className="text-slate-400">Select files and a destination device to start a secure transfer.</p>
                    </header>

                    <div className="space-y-8">
                        {/* File Selection */}
                        <section
                            className={`glass-panel p-8 transition-colors duration-200 ${isDragging ? 'drag-active' : ''}`}
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                        >
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold text-white">Source Files</h3>
                                <div className="flex items-stretch rounded-lg overflow-hidden border border-slate-700">
                                    <button
                                        onClick={handleSelectFiles}
                                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium transition-colors flex items-center border-r border-slate-700"
                                        title="Add Files"
                                    >
                                        <svg className="mr-2" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        Add Files
                                    </button>
                                    <button
                                        onClick={handleSelectFolder}
                                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white transition-colors flex items-center border-r border-slate-700"
                                        title="Add Folder"
                                    >
                                        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={handleSendClipboard}
                                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white transition-colors flex items-center"
                                        title="Paste from Clipboard"
                                    >
                                        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {selectedFiles.length === 0 ? (
                                <div className="border-2 border-dashed border-slate-700/50 rounded-xl p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-500">
                                        <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                        </svg>
                                    </div>
                                    <p className="text-slate-400 mb-2 font-medium">No files selected</p>
                                    <p className="text-xs text-slate-500">Click the button above to browse your computer</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center px-1">
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold text-slate-500 uppercase">{selectedFiles.length} item(s) ready</span>
                                            <span className="text-[10px] text-blue-400 font-bold uppercase">Total Size: {formatBytes(selectedFiles.reduce((acc, f) => acc + f.size, 0))}</span>
                                        </div>
                                        <button
                                            onClick={() => setSelectedFiles([])}
                                            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-md border border-slate-700 transition-all"
                                        >
                                            Clear All
                                        </button>
                                    </div>
                                    <div className="max-h-64 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                                        {selectedFiles.map((file, idx) => (
                                            <div key={idx} className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/5 group">
                                                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center text-blue-400">
                                                    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                                    </svg>
                                                </div>
                                                <span className="text-sm font-medium flex-1 truncate">{file.name}</span>
                                                <button
                                                    onClick={() => setSelectedFiles(f => f.filter((_, i) => i !== idx))}
                                                    className="opacity-0 group-hover:opacity-100 p-2 text-slate-500 hover:text-red-400 transition-all"
                                                >
                                                    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </section>

                        {/* Transfer Control */}
                        <div className="flex flex-col gap-4">
                            <button
                                onClick={handleSend}
                                disabled={!selectedPeer || selectedFiles.length === 0}
                                className="btn btn-primary w-full py-4 text-lg shadow-xl"
                            >
                                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                                {selectedPeer ? `Send to ${selectedPeer.name}` : 'Select a Device to Send'}
                            </button>

                            {/* Transfer Activity List */}
                            {Object.keys(activities).length > 0 && (
                                <div className="flex flex-col gap-4 mt-2">
                                    <div className="flex justify-between items-center px-1">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Transfer Activity</span>
                                        <button
                                            onClick={() => setActivities({})}
                                            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white text-[9px] font-bold rounded-md border border-slate-700 transition-all"
                                        >
                                            Clear History
                                        </button>
                                    </div>
                                    <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                                        {Object.values(activities).sort((a, b) => b.startTime - a.startTime).map(activity => (
                                            <motion.div
                                                key={activity.id}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className={`glass-panel p-4 border-l-4 ${activity.error ? 'border-l-red-500' :
                                                    activity.isCompleted ? 'border-l-green-500' : 'border-l-blue-500'
                                                    }`}
                                            >
                                                <div className="flex justify-between items-start mb-2 gap-2">
                                                    <div className="flex flex-col min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${activity.type === 'sending' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                                                                }`}>
                                                                {activity.type}
                                                            </span>
                                                            <span className="text-sm font-bold text-white truncate">{activity.name}</span>
                                                        </div>
                                                        <span className={`text-xs mt-1 ${activity.error ? 'text-red-400' : 'text-slate-400'}`}>
                                                            {activity.error || activity.status}
                                                        </span>
                                                    </div>
                                                    <span className="text-lg font-black text-blue-500">{activity.progress}%</span>
                                                </div>

                                                {!activity.isCompleted && !activity.error && (
                                                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden p-0">
                                                        <motion.div
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${activity.progress}%` }}
                                                            className="h-full bg-blue-500"
                                                        />
                                                    </div>
                                                )}

                                                {activity.isCompleted && activity.savePath && (
                                                    <button
                                                        onClick={() => window.ipcRenderer.invoke('show-item-in-folder', activity.savePath)}
                                                        className="mt-3 text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase underline"
                                                    >
                                                        Open Folder
                                                    </button>
                                                )}
                                            </motion.div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* Modals & Overlays */}
            <AnimatePresence>
                {incomingTransfer && (
                    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[200] p-6">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="glass-panel p-10 max-w-md w-full shadow-2xl border-blue-500/30"
                        >
                            <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center text-blue-400 mx-auto mb-6">
                                <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-black text-center mb-2">Incoming File</h2>
                            <p className="text-slate-400 text-center mb-8">
                                <span className="text-white font-bold">{incomingTransfer.senderName}</span> wants to send you <span className="text-blue-400 font-bold">{incomingTransfer.fileCount || 1} item(s)</span> totalling <span className="text-blue-400 font-bold">{formatBytes(incomingTransfer.totalSize || incomingTransfer.fileSize)}</span>.
                            </p>
                            <div className="flex gap-4">
                                <button onClick={() => handleDecision(false)} className="btn btn-secondary flex-1 py-3 text-red-400 hover:text-red-300">Decline</button>
                                <button onClick={() => handleDecision(true)} className="btn btn-primary flex-1 py-3">Accept & Save</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <footer className="status-bar">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 rounded-full border border-green-500/20">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">Network Active</span>
                    </div>
                </div>
                <div className="status-version">
                    SecureXfer {pkg.version}
                </div>
            </footer>
        </div>
    )
}
