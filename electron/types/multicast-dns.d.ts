import 'multicast-dns';
import { Answer } from 'dns-packet';

declare module 'multicast-dns' {
    namespace mDNS {
        interface ResponseOutgoingPacket {
            additionals?: Answer[];
        }
    }
}
