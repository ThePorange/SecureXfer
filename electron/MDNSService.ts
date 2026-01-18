import mdns from 'multicast-dns'
import crypto from 'crypto'
import os from 'os'

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
        this.mDNS.on('query', (query) => {
            const isMyService = query.questions.some(q => q.name === this.serviceName)
            if (isMyService) {
                this.announce()
            }
        })

        this.mDNS.on('response', (response) => {
            const ptr = response.answers.find(a => a.name === this.serviceName && a.type === 'PTR')
            if (ptr) {
                const txt = response.additionals.find(a => a.type === 'TXT')
                const srv = response.additionals.find(a => a.type === 'SRV')
                const aRecord = response.additionals.find(a => a.type === 'A')

                if (txt && srv && aRecord) {
                    const idData = txt.data.find((d: any) => d.toString().startsWith('id='))
                    const nameData = txt.data.find((d: any) => d.toString().startsWith('name='))
                    const fpData = txt.data.find((d: any) => d.toString().startsWith('fp='))

                    if (idData && nameData && fpData) {
                        const id = idData.toString().split('=')[1]
                        const name = nameData.toString().split('=')[1]
                        const fingerprint = fpData.toString().split('=')[1]

                        if (id !== this.myId) {
                            this.peers.set(id, {
                                id,
                                name,
                                ip: aRecord.data,
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
        this.mDNS.respond({
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
        })
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
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]!) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address
                }
            }
        }
        return '127.0.0.1'
    }
}
