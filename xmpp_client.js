const EventEmitter = require('events');
const XMPP = require('node-xmpp-client');

const NS_MUC = 'http://jabber.org/protocol/muc';
const NS_DELAY = 'urn:xmpp:delay';
const NS_X_DELAY = 'jabber:x:delay';

module.exports = class XMPPClient extends EventEmitter {
    constructor(jid, pass) {
        super();

        this.jid = new XMPP.JID(jid);
        this.pass = pass;
        this.online = false;
        this.presence = {};
        this.rooms = {};
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

    sendRoomMessage(jid, text) {
        jid = new XMPP.JID(jid);
        const mucJid = jid.bare().toString();

        this.client.send(
            new XMPP.Element('message', {
                to: mucJid,
                type: 'groupchat',
            })
                .c('body')
                .t(text)
                .root()
        );
        console.log(`[${mucJid}] >> ${text}`);
    }
}
