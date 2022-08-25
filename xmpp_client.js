import { EventEmitter } from 'events';
import { default as XMPP } from 'node-xmpp-client';
import { default as crypto } from 'crypto';

const NS_MUC = 'http://jabber.org/protocol/muc';
const NS_DELAY = 'urn:xmpp:delay';
const NS_X_DELAY = 'jabber:x:delay';
const NS_PING = 'urn:xmpp:ping';

export class XMPPClient extends EventEmitter {
    constructor(jid, pass) {
        super();

        this.jid = new XMPP.JID(jid);
        this.pass = pass;
        this.online = false;
        this.presence = {};
        this.rooms = {};
        this.pingIDs = {};
        this._setup();
    }

    _setup() {
        this.client = new XMPP.Client({
            jid: this.jid,
	    password: this.pass,
	    reconnect: true,
	});
        // Keep-alive:
        setInterval(() => this.client.send(" "), 60000);
        setInterval(() => this.pingRooms(), 600000)
        this.client.on('online', () => {
            this.online = true;
            this.sendPresence();
            for(var jid in this.rooms) {
                this.joinRoom(jid);
            }
        });
        this.client.on('end', () => {
            this.online = false;
        });
        this.client.on('stanza', stanza => {
            // console.log('<< ' + stanza.toString());

            if (stanza.is('message') &&
                stanza.attrs.type === 'groupchat') {

                const from = new XMPP.JID(stanza.attrs.from);
                const mucJid = from.bare().toString();
                const fromNick = from.resource;
                const body = stanza.getChildText('body');
                const isHistorical = !! (stanza.getChild('delay', NS_DELAY) || stanza.getChild('x', NS_X_DELAY));
                const room = this.rooms[mucJid];
                const isSelf = room && fromNick === room.nick;
                if (body && room && !isSelf && !isHistorical) {
                    console.log(`[${mucJid}] <${fromNick}> ${body || ""}`);
                    var history = this.rooms[mucJid].history;
                    history.push({
                        nick: fromNick,
                        message: body,
                    });
                    if (history.length > 1000) {
                        this.rooms[mucJid].history = history.slice(-1000);
                    }
                    this.emit('muc:message', mucJid, fromNick, body);
                } else if (isHistorical) {
                    console.log(`[Hist] <${fromNick}> ${body || ""}`);
                } else if (isSelf) {
                    console.log(`[Self] <${fromNick}> ${body || ""}`);
                } else {
                    console.log(`[????] <${fromNick}> ${body || ""}`);
                }
            }
            if (stanza.is('iq')){
                if (Object.keys(this.pingIDs).includes(stanza.attrs.id)){
                    if (stanza.attrs.type == 'error' && stanza.getChild('error')) {
                        mucJid = XMPP.JID(stanza.attrs.from.toString());
                        this.joinRoom(mucJid.bare.toString())
                    }
                    delete this.pingIDs[stanza.attrs.id]
                }
            }
        });
    }

    getHistory(muc) {
        return this.rooms[muc].history;
    }

    sendPresence() {
        this.client.send(this.generatePresence());
    }

    generatePresence() {
	const presence = new XMPP.Element('presence');
        if (this.presence.status) {
	    c('status').t(this.presence.status);
        }
        if (this.presence.show) {
	    c('show').t(this.presence.show);
        }
        return presence;
    }

    joinRoom(jid) {
        jid = new XMPP.JID(jid);
        const mucJid = jid.bare().toString();
        if (!this.rooms[mucJid]) {
            this.rooms[mucJid] = {
                nick: jid.resource,
                history: [],
            };
        }
        const room = this.rooms[mucJid];

        if (this.online) {
            const presence = this.generatePresence();
            presence.attrs.to = `${mucJid}/${room.nick}`;
            presence.c('x', { xmlns: NS_MUC });
            this.client.send(presence);
        }
    }

    sendPing(jid) {
        jid = new XMPP.JID(jid);
        const id = crypto.randomUUID();
        const iq = new XMPP.Stanza('iq', {
            type: 'get',
            to: jid.toString(),
            id: id
        }).c('ping', { xmlns: NS_PING });
        this.pingIDs[id] = jid.toString();
        this.client.send(iq);
    }

    pingRooms() {
        Object.entries(this.rooms).forEach(([mucJid, values]) => {
            this.sendPing(`${mucJid}/${values.nick}`)
        });
    }

    sendRoomMessage(jid, text, extraChildren) {
        jid = new XMPP.JID(jid);
        const mucJid = jid.bare().toString();

        let stanza = new XMPP.Element('message', {
            to: mucJid,
            type: 'groupchat',
        });
        if (text) {
            stanza
                .c('body')
                .t(text);
        }
        if (extraChildren) {
            for(const child of extraChildren) {
                stanza.cnode(child);
            }
        }

        this.client.send(stanza);
        console.log(`[${mucJid}] >> ${text}`);
    }
}
