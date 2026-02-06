import mdns from 'multicast-dns'
import crypto from 'crypto'
import os from 'os'
import { logger } from './logger'

export interface Peer {
    id: string
    name: string
    ip: string
    port: number
    fingerprint: string
    lastSeen: number
}

export class MDNSService {
    private mDNS = mdns()
    private serviceName = 'securexfer.local'
    private peers: Map<string, Peer> = new Map()
    private myId = crypto.randomUUID()
    private myName = os.hostname()
    private myPort: number
    private myFingerprint: string

    constructor(port: number, fingerprint: string) {
        this.myPort = port
        this.myFingerprint = fingerprint
        this.setupListeners()
    }

    private setupListeners() {
        this.mDNS.on('query', (query: any) => {
            logger.info('mDNS query received:', query)
            const isMyService = (query.questions as any[]).some(q => q.name === this.serviceName)
            if (isMyService) {
                logger.info('Received discovery query for SecureXfer service, announcing...')
                this.announce()
            }
        })

        this.mDNS.on('response', (response: any) => {
            logger.info('mDNS response received from network')
            const ptr = (response.answers as any[]).find(a => a.name === this.serviceName && a.type === 'PTR')
            if (ptr) {
                const txt = (response.additionals as any[]).find(a => a.type === 'TXT')
                const srv = (response.additionals as any[]).find(a => a.type === 'SRV')
                const aRecord = (response.additionals as any[]).find(a => a.type === 'A')

                if (txt && srv && aRecord) {
                    const idData = txt.data.find((d: any) => d.toString().startsWith('id='))
                    const nameData = txt.data.find((d: any) => d.toString().startsWith('name='))
                    const fpData = txt.data.find((d: any) => d.toString().startsWith('fp='))

                    if (idData && nameData && fpData) {
                        const id = idData.toString().split('=')[1]
                        const name = nameData.toString().split('=')[1]
                        const fingerprint = fpData.toString().split('=')[1]

                        if (id !== this.myId) {
                            // Create temp peer to check for duplicates
                            const newPeerIp = aRecord.data

                            // Check for existing peer with same IP but different ID (likely app restart)
                            for (const [existingId, existingPeer] of this.peers.entries()) {
                                if (existingPeer.ip === newPeerIp && existingId !== id) {
                                    logger.info(`Removing duplicate peer for IP ${newPeerIp} (Old ID: ${existingId}, New ID: ${id})`)
                                    this.peers.delete(existingId)
                                }
                            }

                            if (!this.peers.has(id)) {
                                logger.info('Peer found:', { id, name, ip: newPeerIp, port: srv.data.port })
                            }

                            this.peers.set(id, {
                                id,
                                name,
                                ip: newPeerIp,
                                port: srv.data.port,
                                fingerprint,
                                lastSeen: Date.now()
                            })
                        }
                    }
                }
            }
        })
    }

    public announce() {
        (this.mDNS as any).respond({
            answers: [{
                name: this.serviceName,
                type: 'PTR',
                data: `${this.myName}.${this.serviceName}`
            }],
            additionals: [
                {
                    name: `${this.myName}.${this.serviceName}`,
                    type: 'SRV',
                    data: { port: this.myPort, target: `${this.myName}.local` }
                },
                {
                    name: `${this.myName}.${this.serviceName}`,
                    type: 'TXT',
                    data: [`id=${this.myId}`, `name=${this.myName}`, `fp=${this.myFingerprint}`]
                },
                {
                    name: `${this.myName}.local`,
                    type: 'A',
                    data: this.getLocalIp()
                }
            ]
        } as any)
    }

    public discover() {
        this.mDNS.query({
            questions: [{
                name: this.serviceName,
                type: 'PTR'
            }]
        })
    }

    public getPeers(): Peer[] {
        const now = Date.now()
        for (const [id, peer] of this.peers.entries()) {
            if (now - peer.lastSeen > 30000) {
                this.peers.delete(id)
            }
        }
        return Array.from(this.peers.values())
    }

    private getLocalIp(): string {
        const interfaces = os.networkInterfaces()
        logger.info('Detecting local network interfaces...')

        // Priority interfaces
        const targetInterfaces = ['Wi-Fi', 'Ethernet', 'WLAN', 'WiFi', 'eth0', 'wlan0']

        let fallbackIp = '127.0.0.1'

        for (const name of Object.keys(interfaces)) {
            const isPriority = targetInterfaces.some(t => name.toLowerCase().includes(t.toLowerCase()))

            for (const iface of interfaces[name]!) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    logger.info(`Interface found: ${name} (${iface.address}) ${isPriority ? '[PRIORITY]' : ''}`)
                    if (isPriority) {
                        return iface.address
                    }
                    fallbackIp = iface.address
                }
            }
        }

        logger.warn(`Using fallback IP: ${fallbackIp}`)
        return fallbackIp
    }

    public destroy() {
        this.mDNS.destroy()
    }
}
